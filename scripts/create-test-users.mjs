#!/usr/bin/env node
/**
 * Create (or reuse) three test users in Supabase Auth + matching member rows.
 *
 * Usage:  node scripts/create-test-users.mjs
 *
 * Creates:
 *   regular@test.zam   — Explorer tier, role = member
 *   premium@test.zam   — Pioneer  tier, role = member
 *   admin@test.zam     — Vanguard tier, role = admin
 *
 * Outputs a JSON file at /tmp/zam-test-users.json that test-api.mjs reads.
 * Safe to re-run — idempotent.
 */

import { writeFileSync } from "fs";

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY      = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Missing env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const serviceHeaders = {
  "Content-Type": "application/json",
  "apikey":        SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
};

const TEST_USERS = [
  { email: "regular@test.zam", password: "TestRegular99!", tier: "Explorer", role: "member", name: "Test Regular User"  },
  { email: "premium@test.zam", password: "TestPremium99!", tier: "Pioneer",  role: "member", name: "Test Premium User"  },
  { email: "admin@test.zam",   password: "TestAdmin99!",   tier: "Vanguard", role: "admin",  name: "Test Admin User"   },
];

// ── helpers ───────────────────────────────────────────────────────────────────
async function getAuthUserByEmail(email) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: serviceHeaders }
  );
  const body = await res.json();
  const users = body.users ?? [];
  return users.find(u => u.email === email) ?? null;
}

async function createAuthUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  "POST",
    headers: serviceHeaders,
    body:    JSON.stringify({ email, password, email_confirm: true }),
  });
  return res.json();
}

async function updateAuthUserPassword(userId, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method:  "PUT",
    headers: serviceHeaders,
    body:    JSON.stringify({ password }),
  });
  return res.json();
}

async function signIn(email, password) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
      body:    JSON.stringify({ email, password }),
    }
  );
  return res.json();
}

async function getMemberRow(authUserId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?auth_user_id=eq.${authUserId}&limit=1`,
    { headers: serviceHeaders }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function createMemberRow({ authUserId, email, name, tier, role }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/members`, {
    method:  "POST",
    headers: { ...serviceHeaders, "Prefer": "return=representation" },
    body: JSON.stringify({
      auth_user_id:  authUserId,
      email,
      name,
      tier,
      role,
      status:        "ACTIVE",
      clearance:     tier === "Vanguard" ? "FULL" : tier === "Pioneer" ? "STANDARD" : "INTERNAL",
      display_level: tier === "Vanguard" ? "Full Operational Clearance" : tier === "Pioneer" ? "Level 2 Pioneer" : "Level 1 Explorer",
      member_since:  new Date().toISOString().slice(0, 10),
    }),
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ── main ──────────────────────────────────────────────────────────────────────
const results = [];

console.log("\n▸ Creating / verifying test users in Supabase Auth...\n");

for (const spec of TEST_USERS) {
  process.stdout.write(`  ${spec.email.padEnd(22)} `);

  // 1. Find or create auth user
  let authUser = await getAuthUserByEmail(spec.email);
  if (!authUser) {
    const created = await createAuthUser(spec.email, spec.password);
    if (created.id) {
      authUser = created;
      process.stdout.write("[auth created] ");
    } else {
      console.log(`\n  ✘  Failed to create auth user: ${JSON.stringify(created)}`);
      continue;
    }
  } else {
    // Ensure password is up-to-date
    await updateAuthUserPassword(authUser.id, spec.password);
    process.stdout.write("[auth exists]  ");
  }

  // 2. Sign in to get token
  const session = await signIn(spec.email, spec.password);
  if (!session.access_token) {
    console.log(`\n  ✘  Sign-in failed: ${JSON.stringify(session).slice(0, 120)}`);
    continue;
  }
  process.stdout.write("[token ok] ");

  // 3. Find or create member row
  let member = await getMemberRow(authUser.id);
  if (!member) {
    member = await createMemberRow({
      authUserId: authUser.id,
      email:      spec.email,
      name:       spec.name,
      tier:       spec.tier,
      role:       spec.role,
    });
    process.stdout.write("[member created]");
  } else {
    process.stdout.write("[member exists] ");
  }

  console.log(" ✔");

  results.push({
    email:         spec.email,
    password:      spec.password,
    role:          spec.role,
    tier:          spec.tier,
    auth_user_id:  authUser.id,
    member_id:     member?.id ?? null,
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
  });
}

if (results.length === 0) {
  console.error("\n✘  No test users created — check errors above.\n");
  process.exit(1);
}

const outPath = "/tmp/zam-test-users.json";
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n✔  ${results.length}/${TEST_USERS.length} users ready → ${outPath}\n`);
