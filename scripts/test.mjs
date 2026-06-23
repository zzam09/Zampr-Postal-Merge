#!/usr/bin/env node
/**
 * Project integration test runner.
 * Usage:  node scripts/test.mjs
 *
 * Covers:
 *   1. API server health endpoint
 *   2. Supabase connectivity (service-role key)
 *   3. Supabase connectivity (anon key — what the frontend uses)
 *   4. All 10 expected tables exist and are queryable
 *   5. Row counts per table
 *   6. Drizzle schema TypeScript compile check
 *   7. Environment variable audit
 */

import { execSync } from "child_process";

// ── Colour helpers ────────────────────────────────────────────────────────────
const CLR = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
};

const pass   = (msg) => console.log(`  ${CLR.green}✔${CLR.reset}  ${msg}`);
const fail   = (msg) => console.log(`  ${CLR.red}✘${CLR.reset}  ${CLR.red}${msg}${CLR.reset}`);
const warn   = (msg) => console.log(`  ${CLR.yellow}⚠${CLR.reset}  ${CLR.yellow}${msg}${CLR.reset}`);
const info   = (msg) => console.log(`  ${CLR.grey}ℹ${CLR.reset}  ${CLR.grey}${msg}${CLR.reset}`);
const header = (msg) => console.log(`\n${CLR.bold}${CLR.cyan}▸ ${msg}${CLR.reset}`);
const divider = ()   => console.log(`${CLR.grey}${"─".repeat(60)}${CLR.reset}`);

// ── Stat tracker ─────────────────────────────────────────────────────────────
const stats = { passed: 0, failed: 0, warned: 0 };
function ok(msg)      { stats.passed++;  pass(msg); }
function ko(msg)      { stats.failed++;  fail(msg); }
function wn(msg)      { stats.warned++;  warn(msg); }

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { json = body; }
  return { status: res.status, ok: res.ok, json };
}

function elapsed(start) {
  return `${(Date.now() - start)}ms`;
}

// ── Config ────────────────────────────────────────────────────────────────────
const API_PORT        = process.env.PORT || 8080;
const API_BASE        = `http://localhost:${API_PORT}/api`;
const SUPABASE_URL    = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY        = process.env.VITE_SUPABASE_ANON_KEY;

const EXPECTED_TABLES = [
  "badges",
  "members",
  "sessions",
  "otp_codes",
  "otp_tokens",
  "notifications",
  "upgrade_requests",
  "profit_distributions",
  "tier_change_history",
  "event_bookings",
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Environment variables
// ─────────────────────────────────────────────────────────────────────────────
function checkEnv() {
  header("Suite 1 — Environment variables");

  const required = [
    ["VITE_SUPABASE_URL",           process.env.VITE_SUPABASE_URL],
    ["VITE_SUPABASE_ANON_KEY",      process.env.VITE_SUPABASE_ANON_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY",   process.env.SUPABASE_SERVICE_ROLE_KEY],
    ["SESSION_SECRET",              process.env.SESSION_SECRET],
  ];

  const optional = [
    ["DATABASE_URL",                process.env.DATABASE_URL],
    ["SUPABASE_DB_URL",             process.env.SUPABASE_DB_URL],
  ];

  // PORT is injected by the Replit workflow runner, not a user secret —
  // it won't be present when running this script directly from the shell.
  if (process.env.PORT) {
    ok(`PORT is set  (${process.env.PORT})  [runtime-injected by workflow]`);
  } else {
    wn(`PORT not set in shell env — defaulting to 8080 for tests  [injected by Replit workflow at runtime]`);
  }

  for (const [name, val] of required) {
    if (val) {
      ok(`${name} is set  (${String(val).slice(0, 30)}${val.length > 30 ? "…" : ""})`);
    } else {
      ko(`${name} is MISSING`);
    }
  }

  for (const [name, val] of optional) {
    if (val) {
      ok(`${name} is set  [optional]`);
    } else {
      wn(`${name} not set  [optional — needed for Drizzle push]`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API server
// ─────────────────────────────────────────────────────────────────────────────
async function checkApiServer() {
  header(`Suite 2 — API server  (${API_BASE})`);

  // Health check
  const t0 = Date.now();
  try {
    const { status, json } = await fetchJSON(`${API_BASE}/healthz`);
    if (status === 200 && json?.status === "ok") {
      ok(`GET /api/healthz → 200 OK  { status: "ok" }  (${elapsed(t0)})`);
    } else {
      ko(`GET /api/healthz → ${status}  body: ${JSON.stringify(json)}`);
    }
  } catch (e) {
    ko(`GET /api/healthz → FAILED: ${e.message}`);
  }

  // 404 on unknown route
  const t1 = Date.now();
  try {
    const { status } = await fetchJSON(`${API_BASE}/this-does-not-exist`);
    if (status === 404) {
      ok(`GET /api/this-does-not-exist → 404 (expected)  (${elapsed(t1)})`);
    } else {
      wn(`Expected 404 on unknown route, got ${status}`);
    }
  } catch (e) {
    ko(`Unknown route test FAILED: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Supabase service-role connectivity
// ─────────────────────────────────────────────────────────────────────────────
async function checkSupabaseServiceRole() {
  header("Suite 3 — Supabase connectivity (service-role key)");

  if (!SUPABASE_URL || !SERVICE_KEY) {
    ko("VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping");
    return null;
  }

  const t0 = Date.now();
  try {
    const { status, json } = await fetchJSON(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey:        SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });

    if (status === 200 && json?.swagger) {
      const tableCount = Object.keys(json.paths || {}).filter(p => p !== "/").length;
      ok(`REST API reachable  (swagger v${json.info?.version}, ${tableCount} paths, ${elapsed(t0)})`);
      return json;
    } else {
      ko(`REST API returned ${status}: ${JSON.stringify(json).slice(0, 120)}`);
      return null;
    }
  } catch (e) {
    ko(`Supabase service-role request FAILED: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Supabase anon key connectivity (what the frontend uses)
// ─────────────────────────────────────────────────────────────────────────────
async function checkSupabaseAnonKey() {
  header("Suite 4 — Supabase connectivity (anon key / frontend)");

  if (!SUPABASE_URL || !ANON_KEY) {
    ko("VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — skipping");
    return;
  }

  const t0 = Date.now();
  try {
    // Badges are publicly readable — anon key should be able to fetch them
    const { status, json } = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/badges?select=id,name,tier_required&limit=5`,
      {
        headers: {
          apikey:        ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
      }
    );

    if (status === 200 && Array.isArray(json)) {
      ok(`Anon key: GET /rest/v1/badges → 200  (${json.length} rows, ${elapsed(t0)})`);
      for (const b of json) {
        info(`  badge: ${b.name}  [${b.tier_required}]`);
      }
    } else if (status === 200) {
      wn(`Anon key: GET /rest/v1/badges → 200 but body is not an array: ${JSON.stringify(json).slice(0,80)}`);
    } else {
      ko(`Anon key: GET /rest/v1/badges → ${status}: ${JSON.stringify(json).slice(0, 120)}`);
    }
  } catch (e) {
    ko(`Supabase anon key request FAILED: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Table existence & row counts
// ─────────────────────────────────────────────────────────────────────────────
async function checkTables(openApiSpec) {
  header("Suite 5 — Table existence & row counts");

  if (!SUPABASE_URL || !SERVICE_KEY) {
    ko("Supabase credentials not set — skipping table checks");
    return;
  }

  // Derive existing tables from spec (or fallback to live query)
  const existingFromSpec = openApiSpec
    ? new Set(Object.keys(openApiSpec.paths || {}).map(p => p.replace("/", "")))
    : null;

  for (const table of EXPECTED_TABLES) {
    // Check table exists in OpenAPI spec
    if (existingFromSpec) {
      if (!existingFromSpec.has(table)) {
        ko(`Table "${table}" NOT FOUND in Supabase schema`);
        continue;
      }
    }

    // Count rows via REST API
    const t0 = Date.now();
    try {
      const { status, json } = await fetchJSON(
        `${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1000`,
        {
          headers: {
            apikey:        SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            Prefer:        "count=exact",
          },
        }
      );

      if (status === 200 && Array.isArray(json)) {
        ok(`${table.padEnd(25)} → ${String(json.length).padStart(3)} row(s)  (${elapsed(t0)})`);
      } else {
        ko(`${table}: unexpected response ${status}: ${JSON.stringify(json).slice(0, 80)}`);
      }
    } catch (e) {
      ko(`${table}: request FAILED: ${e.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — Drizzle schema TypeScript compile
// ─────────────────────────────────────────────────────────────────────────────
function checkDrizzleSchema() {
  header("Suite 6 — Drizzle schema TypeScript compile");

  try {
    const t0 = Date.now();
    execSync(
      "pnpm --filter @workspace/db exec tsc --noEmit --strict --moduleResolution bundler --module esnext --target esnext --skipLibCheck src/schema/index.ts",
      {
        cwd: "/home/runner/workspace/lib/db",
        stdio: "pipe",
        encoding: "utf8",
      }
    );
    ok(`Schema compiles cleanly  (${Date.now() - t0}ms)`);
  } catch (e) {
    const output = (e.stdout || "") + (e.stderr || "");
    ko(`TypeScript errors in schema:\n${output.slice(0, 800)}`);
  }

  // Also check all expected schema files exist
  const schemaFiles = [
    "badges.ts", "members.ts", "sessions.ts", "otp_codes.ts",
    "notifications.ts", "upgrade_requests.ts", "profit_distributions.ts",
    "tier_change_history.ts", "event_bookings.ts",
  ];

  let allPresent = true;
  for (const f of schemaFiles) {
    try {
      execSync(`test -f src/schema/${f}`, {
        cwd: "/home/runner/workspace/lib/db",
        stdio: "pipe",
      });
    } catch {
      ko(`Missing schema file: lib/db/src/schema/${f}`);
      allPresent = false;
    }
  }
  if (allPresent) {
    ok(`All ${schemaFiles.length} schema files present`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 — Migration & seed files
// ─────────────────────────────────────────────────────────────────────────────
function checkMigrationFiles() {
  header("Suite 7 — Migration & seed files");

  const files = [
    ["supabase/migrations/20260623000000_initial_schema.sql", "Initial schema DDL"],
    ["supabase/migrations/20260623000001_rls_policies.sql",   "RLS policies"],
    ["supabase/seed/seed.sql",                                "Seed data"],
    ["supabase/types.ts",                                     "Supabase TypeScript types"],
    ["supabase/config.toml",                                  "Supabase CLI config"],
  ];

  for (const [file, label] of files) {
    try {
      const result = execSync(`wc -l < "${file}"`, {
        cwd: "/home/runner/workspace",
        stdio: "pipe",
        encoding: "utf8",
      }).trim();
      ok(`${label.padEnd(30)} → ${file.split("/").at(-1)}  (${result} lines)`);
    } catch {
      ko(`MISSING: ${file}  [${label}]`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const startAll = Date.now();

  divider();
  console.log(`${CLR.bold}  ZAM Project — Integration Test Runner${CLR.reset}`);
  console.log(`  ${CLR.grey}${new Date().toISOString()}${CLR.reset}`);
  divider();

  checkEnv();
  await checkApiServer();
  const spec = await checkSupabaseServiceRole();
  await checkSupabaseAnonKey();
  await checkTables(spec);
  checkDrizzleSchema();
  checkMigrationFiles();

  // ── Summary ────────────────────────────────────────────────────────────────
  divider();
  const totalTime = elapsed(startAll);
  const total = stats.passed + stats.failed + stats.warned;
  console.log(
    `\n  ${CLR.bold}Results:  ` +
    `${CLR.green}${stats.passed} passed${CLR.reset}  ` +
    `${stats.failed > 0 ? CLR.red : CLR.grey}${stats.failed} failed${CLR.reset}  ` +
    `${stats.warned > 0 ? CLR.yellow : CLR.grey}${stats.warned} warnings${CLR.reset}  ` +
    `${CLR.grey}(${total} checks, ${totalTime})${CLR.reset}\n`
  );
  divider();

  if (stats.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${CLR.red}Unexpected error: ${err.message}${CLR.reset}\n`);
  process.exit(1);
});
