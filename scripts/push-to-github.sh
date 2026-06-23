#!/usr/bin/env bash
# Push all Supabase + Drizzle schema work to GitHub on a new branch.
# Run this manually after ensuring GITHUB_PERSONAL_ACCESS_TOKEN is set.
# Usage: bash scripts/push-to-github.sh

set -euo pipefail

REPO="https://${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/welthguild/zamproject-hono-merged.git"
BRANCH="feat/supabase-schema-alignment"

echo "→ Cloning repo to /tmp/gh-push ..."
rm -rf /tmp/gh-push
git clone "$REPO" /tmp/gh-push
cd /tmp/gh-push

echo "→ Creating branch: $BRANCH"
git checkout -b "$BRANCH"

# ── Copy new files ───────────────────────────────────────────
WORKSPACE="/home/runner/workspace"

echo "→ Copying supabase/ directory ..."
cp -r "$WORKSPACE/supabase" .

echo "→ Copying lib/db/src/schema/ files ..."
mkdir -p lib/db/src/schema
cp "$WORKSPACE/lib/db/src/schema/"*.ts lib/db/src/schema/

echo "→ Done copying."

# ── Commit ───────────────────────────────────────────────────
git add -A
git config user.email "agent@replit.com"
git config user.name "Replit Agent"
git commit -m "feat: align Supabase DB schema, add Drizzle models + migrations + RLS

- supabase/migrations/20260623000000_initial_schema.sql  — full DDL for all 10 tables
- supabase/migrations/20260623000001_rls_policies.sql    — MVP-safe RLS policies
- supabase/seed/seed.sql                                  — demo member, notifications, upgrade requests, etc.
- supabase/config.toml                                    — local Supabase CLI config
- supabase/types.ts                                       — generated Database type covering all 10 tables
- lib/db/src/schema/*.ts                                  — Drizzle ORM table definitions for every table

Tables aligned: badges, members, sessions, otp_codes, otp_tokens,
  notifications, upgrade_requests, profit_distributions,
  tier_change_history, event_bookings

Fixes:
- Frontend client.ts uses VITE_SUPABASE_ANON_KEY (was PUBLISHABLE_KEY)
- types.ts was empty placeholder — now has full Row/Insert/Update types"

echo "→ Pushing to GitHub ..."
git push origin "$BRANCH"

echo ""
echo "✓ Done! Branch pushed: $BRANCH"
echo "  Open a PR at: https://github.com/welthguild/zamproject-hono-merged/compare/$BRANCH"
