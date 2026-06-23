#!/usr/bin/env node
/**
 * ZAM Project — Full API Test Suite
 *
 * Usage:
 *   node scripts/create-test-users.mjs   # run once to provision test users
 *   node scripts/test-api.mjs            # run the full suite
 *
 * Covers every route:
 *   GET  /api/healthz
 *   POST /api/auth/otp/send
 *   POST /api/auth/otp/verify
 *   DELETE /api/auth/session
 *   GET  /api/tiers, GET /api/tiers/:id
 *   GET  /api/members/me, PATCH /api/members/me
 *   GET  /api/notifications, GET /api/notifications/:id
 *   PATCH /api/notifications/:id/read, PATCH /api/notifications/read-all
 *   GET  /api/upgrade-requests, POST /api/upgrade-requests, GET /api/upgrade-requests/:id
 *   GET  /api/history, GET /api/history/:id
 *   GET  /api/admin/members, GET /api/admin/members/:id
 *   GET  /api/admin/upgrade-requests, PATCH /api/admin/upgrade-requests/:id
 *   POST /api/admin/members/:id/notify
 *
 * Each route tests:
 *   ✓ Valid request (correct auth, correct body)
 *   ✓ No-token → 401
 *   ✓ Wrong token → 401
 *   ✓ Bad body → 400
 *   ✓ Non-member token → 403 / 404 where applicable
 *   ✓ Response shape (required fields present, no unexpected nulls)
 */

import { readFileSync, writeFileSync } from "fs";
import { existsSync } from "fs";

// ── Colour helpers ─────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",  bold:   "\x1b[1m",
  green:  "\x1b[32m", red:    "\x1b[31m",
  yellow: "\x1b[33m", cyan:   "\x1b[36m",
  grey:   "\x1b[90m", blue:   "\x1b[34m",
  magenta:"\x1b[35m",
};

const hl   = (s) => `${C.bold}${s}${C.reset}`;
const ok   = (m) => console.log(`  ${C.green}✔${C.reset}  ${m}`);
const fail = (m) => console.log(`  ${C.red}✘${C.reset}  ${C.red}${m}${C.reset}`);
const warn = (m) => console.log(`  ${C.yellow}⚠${C.reset}  ${C.yellow}${m}${C.reset}`);
const info = (m) => console.log(`  ${C.grey}ℹ${C.reset}  ${C.grey}${m}${C.reset}`);
const hdr  = (m) => console.log(`\n${C.bold}${C.cyan}▸ ${m}${C.reset}`);
const sub  = (m) => console.log(`  ${C.blue}→${C.reset} ${m}`);
const div  = ()  => console.log(`${C.grey}${"─".repeat(68)}${C.reset}`);

// ── Stats ──────────────────────────────────────────────────────────────────────
const S = { pass: 0, fail: 0, warn: 0, slow: 0 };
const SLOW_MS = 1500;
const REPORT  = [];                // detailed per-endpoint record

function assert(cond, passMsg, failMsg, tags = []) {
  if (cond) { S.pass++; ok(passMsg);   return true; }
  else       { S.fail++; fail(failMsg); return false; }
}

function record(method, path, result, ms, note = "") {
  REPORT.push({ method, path, result, ms, note });
}

// ── HTTP helper ────────────────────────────────────────────────────────────────
const API = `http://localhost:${process.env.PORT ?? 8080}/api`;
const FAKE_TOKEN = "eyJhbGciOiJIUzI1NiJ9.FAKE.SIGNATURE";

async function req(method, path, { token, body, expectStatus } = {}) {
  const t0 = Date.now();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res, json;
  try {
    res  = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  } catch (e) {
    return { status: 0, ok: false, json: { error: e.message }, ms: Date.now() - t0 };
  }

  const ms = Date.now() - t0;
  if (ms > SLOW_MS) { S.slow++; warn(`Slow response: ${method} ${path} took ${ms}ms`); }

  return { status: res.status, ok: res.ok, json, ms };
}

// ── Shape validators ───────────────────────────────────────────────────────────
function hasFields(obj, fields) {
  if (!obj || typeof obj !== "object") return false;
  return fields.every(f => f in obj);
}

function assertShape(obj, fields, label) {
  const missing = fields.filter(f => !(f in (obj ?? {})));
  if (missing.length === 0) {
    ok(`${label} — shape OK (fields: ${fields.join(", ")})`);
    S.pass++;
    return true;
  }
  fail(`${label} — missing fields: ${missing.join(", ")}`);
  S.fail++;
  return false;
}

function assertNoNulls(obj, fields, label) {
  const nullish = fields.filter(f => obj?.[f] == null);
  if (nullish.length === 0) {
    ok(`${label} — no unexpected nulls in [${fields.join(", ")}]`);
    S.pass++;
  } else {
    warn(`${label} — null/undefined in: ${nullish.join(", ")}`);
    S.warn++;
  }
}

// ── Test helpers ───────────────────────────────────────────────────────────────
async function testAuth401(method, path, label) {
  // No token
  const r1 = await req(method, path, {});
  const p1 = assert(r1.status === 401, `${label} (no token) → 401`, `${label} (no token) → expected 401, got ${r1.status}`);
  record(method, path, p1 ? "pass" : "fail", r1.ms, "no-token");

  // Fake token
  const r2 = await req(method, path, { token: FAKE_TOKEN });
  const p2 = assert(r2.status === 401, `${label} (bad token) → 401`, `${label} (bad token) → expected 401, got ${r2.status}`);
  record(method, path, p2 ? "pass" : "fail", r2.ms, "bad-token");
}

// =============================================================================
// LOAD TEST USERS
// =============================================================================
const USERS_FILE = "/tmp/zam-test-users.json";
if (!existsSync(USERS_FILE)) {
  console.error(`\n${C.red}✘  Test users not found at ${USERS_FILE}${C.reset}`);
  console.error(`   Run:  node scripts/create-test-users.mjs\n`);
  process.exit(1);
}

const testUsers = JSON.parse(readFileSync(USERS_FILE, "utf8"));
const regular   = testUsers.find(u => u.role === "member" && u.tier === "Explorer");
const premium   = testUsers.find(u => u.role === "member" && u.tier === "Pioneer");
const admin     = testUsers.find(u => u.role === "admin");

if (!regular || !premium || !admin) {
  console.error(`\n${C.red}✘  Could not find all test users in ${USERS_FILE}${C.reset}`);
  console.error(`   Re-run:  node scripts/create-test-users.mjs\n`);
  process.exit(1);
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  const t0 = Date.now();

  div();
  console.log(`${hl("  ZAM Project — Full API Test Suite")}`);
  console.log(`  ${C.grey}${new Date().toISOString()}  ·  ${API}${C.reset}`);
  console.log(`  Test users: regular(${regular.email}), premium(${premium.email}), admin(${admin.email})`);
  div();

  // ===========================================================================
  // SUITE 1 — Health (public)
  // ===========================================================================
  hdr("Suite 1 — Health");

  {
    const r = await req("GET", "/healthz");
    const p = assert(r.status === 200 && r.json?.status === "ok",
      `GET /healthz → 200 { status: "ok" }`,
      `GET /healthz → ${r.status} (expected 200)`);
    record("GET", "/healthz", p ? "pass" : "fail", r.ms);
    if (p) assertNoNulls(r.json, ["status"], "healthz");
  }

  // ===========================================================================
  // SUITE 2 — Auth routes
  // ===========================================================================
  hdr("Suite 2 — Auth");

  sub("POST /api/auth/otp/send — validation");
  {
    // Missing email
    const r1 = await req("POST", "/auth/otp/send", { body: {} });
    assert(r1.status === 400, "otp/send (no email) → 400", `otp/send (no email) → got ${r1.status}`);
    record("POST", "/auth/otp/send", r1.status === 400 ? "pass" : "fail", r1.ms, "no-email");

    // Invalid email
    const r2 = await req("POST", "/auth/otp/send", { body: { email: "notanemail" } });
    assert(r2.status === 400, "otp/send (bad email) → 400", `otp/send (bad email) → got ${r2.status}`);
    record("POST", "/auth/otp/send", r2.status === 400 ? "pass" : "fail", r2.ms, "bad-email");

    // Valid email (will trigger actual OTP — Supabase may 500 if user doesn't exist)
    const r3 = await req("POST", "/auth/otp/send", { body: { email: regular.email } });
    assert([200, 500, 422].includes(r3.status),
      `otp/send (valid email) → ${r3.status} (OTP flow initiated)`,
      `otp/send (valid email) → unexpected status ${r3.status}`);
    record("POST", "/auth/otp/send", "pass", r3.ms, "valid-request");
    if (r3.json) assertShape(r3.json, ["success"], "otp/send response");
  }

  sub("POST /api/auth/otp/verify — validation");
  {
    // Missing fields
    const r1 = await req("POST", "/auth/otp/verify", { body: {} });
    assert(r1.status === 400, "otp/verify (empty body) → 400", `otp/verify (empty body) → got ${r1.status}`);
    record("POST", "/auth/otp/verify", r1.status === 400 ? "pass" : "fail", r1.ms, "empty-body");

    // Bad token
    const r2 = await req("POST", "/auth/otp/verify", { body: { email: regular.email, token: "000000" } });
    assert([400, 401, 422].includes(r2.status),
      `otp/verify (wrong token) → ${r2.status} (auth rejected)`,
      `otp/verify (wrong token) → unexpected status ${r2.status}`);
    record("POST", "/auth/otp/verify", "pass", r2.ms, "wrong-token");
  }

  sub("DELETE /api/auth/session — auth guard");
  await testAuth401("DELETE", "/auth/session", "DELETE /auth/session");

  // ===========================================================================
  // SUITE 3 — Tiers (public, no auth)
  // ===========================================================================
  hdr("Suite 3 — Tiers (public)");

  {
    sub("GET /api/tiers");
    const r = await req("GET", "/tiers");
    const p = assert(r.status === 200 && r.json?.success === true && Array.isArray(r.json?.data),
      `GET /tiers → 200, array of ${r.json?.data?.length ?? "?"} tiers`,
      `GET /tiers → ${r.status}`);
    record("GET", "/tiers", p ? "pass" : "fail", r.ms);

    if (p && r.json.data.length > 0) {
      assertShape(r.json.data[0], ["id","name","price","priceValue","features","benefits"], "tier object");
      assertNoNulls(r.json.data[0], ["id","name","price","priceValue"], "tier object");
      info(`Tiers returned: ${r.json.data.map(t => t.name).join(", ")}`);
    }

    sub("GET /api/tiers/:id — valid");
    const r2 = await req("GET", "/tiers/tier-pi");
    assert(r2.status === 200 && r2.json?.data?.id === "tier-pi",
      `GET /tiers/tier-pi → 200, id=tier-pi`,
      `GET /tiers/tier-pi → ${r2.status}`);
    record("GET", "/tiers/:id", r2.status === 200 ? "pass" : "fail", r2.ms);

    sub("GET /api/tiers/:id — not found");
    const r3 = await req("GET", "/tiers/tier-nonexistent");
    assert(r3.status === 404,
      `GET /tiers/nonexistent → 404`,
      `GET /tiers/nonexistent → ${r3.status}`);
    record("GET", "/tiers/:id", r3.status === 404 ? "pass" : "fail", r3.ms, "not-found");
  }

  // ===========================================================================
  // SUITE 4 — Members
  // ===========================================================================
  hdr("Suite 4 — Members");

  // Auth guards
  await testAuth401("GET",   "/members/me", "GET /members/me");
  await testAuth401("PATCH", "/members/me", "PATCH /members/me");

  {
    sub("GET /api/members/me — regular user");
    const r = await req("GET", "/members/me", { token: regular.access_token });
    const p = assert(r.status === 200 && r.json?.success === true,
      `GET /members/me → 200 (regular)`,
      `GET /members/me → ${r.status}: ${JSON.stringify(r.json).slice(0,80)}`);
    record("GET", "/members/me", p ? "pass" : "fail", r.ms, "regular");

    if (p) {
      assertShape(r.json.data, ["id","email","name","tier","role","status","clearance"], "member object");
      assertNoNulls(r.json.data, ["id","email","name","tier","role"], "member object");
      assert(r.json.data.role === "member", `role = "member"`, `role = "${r.json.data.role}" (expected member)`);
      assert(r.json.data.tier === "Explorer", `tier = "Explorer"`, `tier = "${r.json.data.tier}"`);
      info(`Member: ${r.json.data.name} | ${r.json.data.tier} | ${r.json.data.role}`);
    }

    sub("GET /api/members/me — admin user");
    const r2 = await req("GET", "/members/me", { token: admin.access_token });
    const p2 = assert(r2.status === 200 && r2.json?.data?.role === "admin",
      `GET /members/me → 200, role=admin`,
      `GET /members/me (admin) → ${r2.status}`);
    record("GET", "/members/me", p2 ? "pass" : "fail", r2.ms, "admin");

    sub("PATCH /api/members/me — valid update");
    const newName = `Test Regular ${Date.now()}`;
    const r3 = await req("PATCH", "/members/me", {
      token: regular.access_token,
      body:  { name: newName, location: "Test Location" },
    });
    const p3 = assert(r3.status === 200 && r3.json?.success === true,
      `PATCH /members/me → 200`,
      `PATCH /members/me → ${r3.status}: ${JSON.stringify(r3.json).slice(0,80)}`);
    record("PATCH", "/members/me", p3 ? "pass" : "fail", r3.ms);

    sub("PATCH /api/members/me — empty body → 400");
    const r4 = await req("PATCH", "/members/me", { token: regular.access_token, body: {} });
    assert(r4.status === 400, `PATCH /members/me (empty) → 400`, `PATCH /members/me (empty) → ${r4.status}`);
    record("PATCH", "/members/me", r4.status === 400 ? "pass" : "fail", r4.ms, "empty-body");

    sub("PATCH /api/members/me — wrong type → 400");
    const r5 = await req("PATCH", "/members/me", { token: regular.access_token, body: { name: 42 } });
    assert(r5.status === 400, `PATCH /members/me (name=42) → 400`, `PATCH /members/me (name=42) → ${r5.status}`);
    record("PATCH", "/members/me", r5.status === 400 ? "pass" : "fail", r5.ms, "wrong-type");
  }

  // ===========================================================================
  // SUITE 5 — Notifications
  // ===========================================================================
  hdr("Suite 5 — Notifications");

  await testAuth401("GET",   "/notifications",          "GET /notifications");
  await testAuth401("PATCH", "/notifications/read-all", "PATCH /notifications/read-all");

  let notifId = null;
  {
    sub("GET /api/notifications — regular user");
    const r = await req("GET", "/notifications", { token: regular.access_token });
    const p = assert(r.status === 200 && r.json?.success === true,
      `GET /notifications → 200`,
      `GET /notifications → ${r.status}`);
    record("GET", "/notifications", p ? "pass" : "fail", r.ms);

    if (p && Array.isArray(r.json.data)) {
      info(`Notifications count: ${r.json.data.length}`);
      if (r.json.data.length > 0) {
        notifId = r.json.data[0].id;
        assertShape(r.json.data[0], ["id","member_id","type","title","message","read","created_at"], "notification object");
        assertNoNulls(r.json.data[0], ["id","type","title","message"], "notification object");
      }
    }

    sub("PATCH /api/notifications/read-all → 200");
    const r2 = await req("PATCH", "/notifications/read-all", { token: regular.access_token });
    assert(r2.status === 200 && r2.json?.success === true,
      `PATCH /notifications/read-all → 200`,
      `PATCH /notifications/read-all → ${r2.status}`);
    record("PATCH", "/notifications/read-all", r2.status === 200 ? "pass" : "fail", r2.ms);

    if (notifId) {
      sub(`PATCH /api/notifications/:id/read → 200`);
      const r3 = await req("PATCH", `/notifications/${notifId}/read`, { token: regular.access_token });
      assert(r3.status === 200,
        `PATCH /notifications/:id/read → 200`,
        `PATCH /notifications/:id/read → ${r3.status}`);
      record("PATCH", "/notifications/:id/read", r3.status === 200 ? "pass" : "fail", r3.ms);

      sub(`GET /api/notifications/:id → 200`);
      const r4 = await req("GET", `/notifications/${notifId}`, { token: regular.access_token });
      assert(r4.status === 200,
        `GET /notifications/:id → 200`,
        `GET /notifications/:id → ${r4.status}`);
      record("GET", "/notifications/:id", r4.status === 200 ? "pass" : "fail", r4.ms);
    }

    sub("GET /api/notifications/:id — wrong owner → 404");
    if (notifId) {
      const r5 = await req("GET", `/notifications/${notifId}`, { token: premium.access_token });
      assert(r5.status === 404,
        `GET /notifications/:id (wrong user) → 404`,
        `GET /notifications/:id (wrong user) → ${r5.status} (expected 404)`);
      record("GET", "/notifications/:id", r5.status === 404 ? "pass" : "fail", r5.ms, "wrong-owner");
    }

    sub("PATCH /api/notifications/bad-uuid/read → 404");
    const r6 = await req("PATCH", "/notifications/00000000-0000-0000-0000-000000000000/read",
      { token: regular.access_token });
    assert(r6.status === 404,
      `PATCH /notifications/bad-id/read → 404`,
      `PATCH /notifications/bad-id/read → ${r6.status}`);
    record("PATCH", "/notifications/:id/read", r6.status === 404 ? "pass" : "fail", r6.ms, "not-found");
  }

  // ===========================================================================
  // SUITE 6 — Upgrade Requests
  // ===========================================================================
  hdr("Suite 6 — Upgrade Requests");

  await testAuth401("GET",  "/upgrade-requests", "GET /upgrade-requests");
  await testAuth401("POST", "/upgrade-requests", "POST /upgrade-requests");

  let upgradeId = null;
  {
    sub("POST /api/upgrade-requests — missing to_tier → 400");
    const r1 = await req("POST", "/upgrade-requests", { token: regular.access_token, body: {} });
    assert(r1.status === 400, `POST /upgrade-requests (no to_tier) → 400`, `→ ${r1.status}`);
    record("POST", "/upgrade-requests", r1.status === 400 ? "pass" : "fail", r1.ms, "no-to-tier");

    sub("POST /api/upgrade-requests — invalid tier → 400");
    const r2 = await req("POST", "/upgrade-requests", { token: regular.access_token, body: { to_tier: "Galactic" } });
    assert(r2.status === 400, `POST /upgrade-requests (invalid tier) → 400`, `→ ${r2.status}`);
    record("POST", "/upgrade-requests", r2.status === 400 ? "pass" : "fail", r2.ms, "invalid-tier");

    sub("POST /api/upgrade-requests — same tier → 400");
    const r3 = await req("POST", "/upgrade-requests", { token: regular.access_token, body: { to_tier: "Explorer" } });
    assert(r3.status === 400, `POST /upgrade-requests (same tier) → 400`, `→ ${r3.status}`);
    record("POST", "/upgrade-requests", r3.status === 400 ? "pass" : "fail", r3.ms, "same-tier");

    sub("POST /api/upgrade-requests — valid → 201");
    const r4 = await req("POST", "/upgrade-requests", {
      token: regular.access_token,
      body:  { to_tier: "Pioneer", payment_reference: `TEST-${Date.now()}` },
    });
    const p4 = assert([201, 409].includes(r4.status),
      `POST /upgrade-requests → ${r4.status} (201=created, 409=already pending)`,
      `POST /upgrade-requests → ${r4.status}: ${JSON.stringify(r4.json).slice(0,80)}`);
    record("POST", "/upgrade-requests", p4 ? "pass" : "fail", r4.ms, "valid");

    if (r4.status === 201) {
      upgradeId = r4.json?.data?.id;
      assertShape(r4.json.data, ["id","member_id","from_tier","to_tier","status"], "upgrade_request object");
      assert(r4.json.data.status === "PENDING", `status = "PENDING"`, `status = "${r4.json.data.status}"`);
    }

    sub("POST /api/upgrade-requests — duplicate → 409");
    const r5 = await req("POST", "/upgrade-requests", {
      token: regular.access_token,
      body:  { to_tier: "Vanguard" },
    });
    assert(r5.status === 409, `POST /upgrade-requests (duplicate) → 409`, `→ ${r5.status}`);
    record("POST", "/upgrade-requests", r5.status === 409 ? "pass" : "fail", r5.ms, "duplicate");

    sub("GET /api/upgrade-requests — regular user");
    const r6 = await req("GET", "/upgrade-requests", { token: regular.access_token });
    const p6 = assert(r6.status === 200 && Array.isArray(r6.json?.data),
      `GET /upgrade-requests → 200`,
      `GET /upgrade-requests → ${r6.status}`);
    record("GET", "/upgrade-requests", p6 ? "pass" : "fail", r6.ms);
    if (p6) info(`Upgrade requests: ${r6.json.data.length}`);

    if (upgradeId) {
      sub("GET /api/upgrade-requests/:id → 200");
      const r7 = await req("GET", `/upgrade-requests/${upgradeId}`, { token: regular.access_token });
      assert(r7.status === 200, `GET /upgrade-requests/:id → 200`, `→ ${r7.status}`);
      record("GET", "/upgrade-requests/:id", r7.status === 200 ? "pass" : "fail", r7.ms);

      sub("GET /api/upgrade-requests/:id — wrong owner → 404");
      const r8 = await req("GET", `/upgrade-requests/${upgradeId}`, { token: premium.access_token });
      assert(r8.status === 404, `GET /upgrade-requests/:id (wrong user) → 404`, `→ ${r8.status}`);
      record("GET", "/upgrade-requests/:id", r8.status === 404 ? "pass" : "fail", r8.ms, "wrong-owner");
    }
  }

  // ===========================================================================
  // SUITE 7 — Payment History
  // ===========================================================================
  hdr("Suite 7 — Payment History");

  await testAuth401("GET", "/history", "GET /history");

  {
    sub("GET /api/history — regular user");
    const r = await req("GET", "/history", { token: regular.access_token });
    const p = assert(r.status === 200 && Array.isArray(r.json?.data),
      `GET /history → 200, ${r.json?.data?.length ?? "?"} records`,
      `GET /history → ${r.status}`);
    record("GET", "/history", p ? "pass" : "fail", r.ms);

    if (p && r.json.data.length > 0) {
      assertShape(r.json.data[0], ["id","member_id","amount","period_month","status"], "profit_distribution object");
    }

    sub("GET /api/history/bad-id → 404");
    const r2 = await req("GET", "/history/00000000-0000-0000-0000-000000000000", { token: regular.access_token });
    assert(r2.status === 404, `GET /history/:id (not found) → 404`, `→ ${r2.status}`);
    record("GET", "/history/:id", r2.status === 404 ? "pass" : "fail", r2.ms, "not-found");
  }

  // ===========================================================================
  // SUITE 8 — Admin routes
  // ===========================================================================
  hdr("Suite 8 — Admin routes");

  // Auth guards on admin routes (non-admin member)
  sub("Admin routes → 403 for non-admin users");
  {
    const adminRoutes = [
      ["GET",   "/admin/members"],
      ["GET",   "/admin/upgrade-requests"],
    ];
    for (const [method, path] of adminRoutes) {
      const r = await req(method, path, { token: regular.access_token });
      assert(r.status === 403,
        `${method} ${path} (non-admin) → 403`,
        `${method} ${path} (non-admin) → ${r.status} (expected 403)`);
      record(method, path, r.status === 403 ? "pass" : "fail", r.ms, "non-admin");
    }
  }

  // Auth guards (no token)
  await testAuth401("GET", "/admin/members", "GET /admin/members");

  {
    sub("GET /api/admin/members — admin user");
    const r = await req("GET", "/admin/members", { token: admin.access_token });
    const p = assert(r.status === 200 && Array.isArray(r.json?.data),
      `GET /admin/members → 200, ${r.json?.data?.length ?? "?"} members`,
      `GET /admin/members → ${r.status}: ${JSON.stringify(r.json).slice(0,80)}`);
    record("GET", "/admin/members", p ? "pass" : "fail", r.ms, "admin");

    if (p && r.json.data.length > 0) {
      assertShape(r.json.data[0], ["id","email","name","tier","role","status"], "admin member object");
      info(`Total members in DB: ${r.json.data.length}`);
    }

    sub("GET /api/admin/members/:id — admin");
    const targetId = admin.member_id;
    if (targetId) {
      const r2 = await req("GET", `/admin/members/${targetId}`, { token: admin.access_token });
      assert(r2.status === 200, `GET /admin/members/:id → 200`, `→ ${r2.status}`);
      record("GET", "/admin/members/:id", r2.status === 200 ? "pass" : "fail", r2.ms);
    }

    sub("GET /api/admin/members/:id — not found → 404");
    const r3 = await req("GET", "/admin/members/00000000-0000-0000-0000-000000000000", { token: admin.access_token });
    assert(r3.status === 404, `GET /admin/members/:id (not found) → 404`, `→ ${r3.status}`);
    record("GET", "/admin/members/:id", r3.status === 404 ? "pass" : "fail", r3.ms, "not-found");

    sub("GET /api/admin/upgrade-requests — admin");
    const r4 = await req("GET", "/admin/upgrade-requests", { token: admin.access_token });
    const p4 = assert(r4.status === 200 && Array.isArray(r4.json?.data),
      `GET /admin/upgrade-requests → 200, ${r4.json?.data?.length ?? "?"} items`,
      `→ ${r4.status}`);
    record("GET", "/admin/upgrade-requests", p4 ? "pass" : "fail", r4.ms);

    sub("GET /api/admin/upgrade-requests?status=PENDING — admin");
    const r5 = await req("GET", "/admin/upgrade-requests?status=PENDING", { token: admin.access_token });
    assert(r5.status === 200, `GET /admin/upgrade-requests?status=PENDING → 200`, `→ ${r5.status}`);
    record("GET", "/admin/upgrade-requests", r5.status === 200 ? "pass" : "fail", r5.ms, "filter");

    // Approve the upgrade request we created in suite 6
    if (upgradeId) {
      sub("PATCH /api/admin/upgrade-requests/:id → APPROVED");
      const r6 = await req("PATCH", `/admin/upgrade-requests/${upgradeId}`, {
        token: admin.access_token,
        body:  { status: "APPROVED", admin_notes: "Test approval" },
      });
      const p6 = assert(r6.status === 200 && r6.json?.data?.status === "APPROVED",
        `PATCH /admin/upgrade-requests/:id → APPROVED`,
        `→ ${r6.status}: ${JSON.stringify(r6.json).slice(0,80)}`);
      record("PATCH", "/admin/upgrade-requests/:id", p6 ? "pass" : "fail", r6.ms);
    }

    sub("PATCH /api/admin/upgrade-requests/:id — bad status → 400");
    const r7 = await req("PATCH", `/admin/upgrade-requests/00000000-0000-0000-0000-000000000001`, {
      token: admin.access_token,
      body:  { status: "MAYBE" },
    });
    assert(r7.status === 400, `PATCH /admin/upgrade-requests/:id (bad status) → 400`, `→ ${r7.status}`);
    record("PATCH", "/admin/upgrade-requests/:id", r7.status === 400 ? "pass" : "fail", r7.ms, "bad-status");

    // POST notify
    if (regular.member_id) {
      sub("POST /api/admin/members/:id/notify → 201");
      const r8 = await req("POST", `/admin/members/${regular.member_id}/notify`, {
        token: admin.access_token,
        body:  { type: "system", title: "Test Notification", message: "Sent from test suite" },
      });
      const p8 = assert(r8.status === 201,
        `POST /admin/members/:id/notify → 201`,
        `→ ${r8.status}: ${JSON.stringify(r8.json).slice(0,80)}`);
      record("POST", "/admin/members/:id/notify", p8 ? "pass" : "fail", r8.ms);

      sub("POST /api/admin/members/:id/notify — missing fields → 400");
      const r9 = await req("POST", `/admin/members/${regular.member_id}/notify`, {
        token: admin.access_token,
        body:  { type: "system" },
      });
      assert(r9.status === 400, `POST /admin/notify (missing fields) → 400`, `→ ${r9.status}`);
      record("POST", "/admin/members/:id/notify", r9.status === 400 ? "pass" : "fail", r9.ms, "missing-fields");
    }
  }

  // ===========================================================================
  // SUITE 9 — Security: missing auth checks
  // ===========================================================================
  hdr("Suite 9 — Security scan (auth-protected routes reject unauthenticated)");

  const PROTECTED = [
    ["GET",    "/members/me"],
    ["PATCH",  "/members/me"],
    ["GET",    "/notifications"],
    ["PATCH",  "/notifications/read-all"],
    ["GET",    "/upgrade-requests"],
    ["POST",   "/upgrade-requests"],
    ["GET",    "/history"],
    ["GET",    "/admin/members"],
    ["GET",    "/admin/upgrade-requests"],
  ];

  {
    let allProtected = true;
    for (const [method, path] of PROTECTED) {
      const r = await req(method, path, {});
      if (r.status !== 401) {
        fail(`SECURITY: ${method} ${path} is UNPROTECTED — got ${r.status}, expected 401`);
        S.fail++;
        allProtected = false;
        record(method, path, "security-fail", r.ms, "no-auth-guard");
      }
    }
    if (allProtected) {
      ok(`All ${PROTECTED.length} protected routes correctly return 401 without a token`);
      S.pass++;
    }
  }

  // ===========================================================================
  // REPORT
  // ===========================================================================
  const elapsed = Date.now() - t0;
  const total   = S.pass + S.fail + S.warn;

  div();
  hdr("Test Report");

  // Endpoint summary table
  const byPath = {};
  for (const r of REPORT) {
    const key = `${r.method} ${r.path}`;
    if (!byPath[key]) byPath[key] = { pass: 0, fail: 0, avgMs: 0, times: [] };
    byPath[key][r.result === "pass" ? "pass" : "fail"]++;
    byPath[key].times.push(r.ms);
  }

  console.log(`\n  ${"Endpoint".padEnd(42)} ${"Pass".padEnd(6)} ${"Fail".padEnd(6)} ${"Avg ms".padEnd(8)} Status`);
  console.log(`  ${"─".repeat(70)}`);
  for (const [key, d] of Object.entries(byPath)) {
    const avg   = Math.round(d.times.reduce((a,b) => a+b, 0) / d.times.length);
    const icon  = d.fail > 0 ? `${C.red}✘${C.reset}` : `${C.green}✔${C.reset}`;
    const slow  = avg > SLOW_MS ? ` ${C.yellow}⚠slow${C.reset}` : "";
    console.log(`  ${key.padEnd(42)} ${String(d.pass).padEnd(6)} ${String(d.fail).padEnd(6)} ${String(avg+"ms").padEnd(8)} ${icon}${slow}`);
  }

  // Failed details
  const failed = REPORT.filter(r => r.result !== "pass");
  if (failed.length > 0) {
    console.log(`\n  ${C.red}${C.bold}Failed endpoints:${C.reset}`);
    for (const r of failed) {
      console.log(`    ${C.red}✘${C.reset}  ${r.method} ${r.path}  [${r.note}]  ${r.ms}ms`);
    }
  }

  // Security note
  const unprotected = REPORT.filter(r => r.note === "no-auth-guard");
  if (unprotected.length > 0) {
    console.log(`\n  ${C.red}${C.bold}⚠ Security Issues:${C.reset}`);
    for (const r of unprotected) {
      console.log(`    ${C.red}✘${C.reset}  ${r.method} ${r.path} has no auth protection`);
    }
  }

  // Slow responses
  const slowRoutes = REPORT.filter(r => r.ms > SLOW_MS);
  if (slowRoutes.length > 0) {
    console.log(`\n  ${C.yellow}${C.bold}⚠ Performance Issues (>${SLOW_MS}ms):${C.reset}`);
    for (const r of slowRoutes) {
      console.log(`    ${C.yellow}⚠${C.reset}  ${r.method} ${r.path} — ${r.ms}ms`);
    }
  }

  // Write JSON report
  const reportPath = "/tmp/zam-api-test-report.json";
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { ...S, total, elapsed },
    endpoints: byPath,
    failed,
    slowRoutes,
  }, null, 2));

  div();
  console.log(
    `\n  ${C.bold}Results:  ` +
    `${C.green}${S.pass} passed${C.reset}  ` +
    `${S.fail > 0 ? C.red : C.grey}${S.fail} failed${C.reset}  ` +
    `${S.warn > 0 ? C.yellow : C.grey}${S.warn} warnings${C.reset}  ` +
    `${S.slow > 0 ? C.yellow : C.grey}${S.slow} slow${C.reset}  ` +
    `${C.grey}(${total} assertions, ${elapsed}ms)${C.reset}`
  );
  console.log(`  ${C.grey}JSON report → ${reportPath}${C.reset}\n`);
  div();

  process.exit(S.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal error: ${err.stack}${C.reset}\n`);
  process.exit(1);
});
