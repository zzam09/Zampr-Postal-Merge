# ZAM Project — Hono Merged

Member portal for a tiered membership platform (Explorer / Pioneer / Vanguard tiers) with OTP auth, upgrade requests, profit distributions, and event bookings. Backend is Express + Drizzle ORM; data layer is Supabase (PostgreSQL).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (uses `PORT` env var)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/db run push` — push Drizzle schema to database (dev only, requires `DATABASE_URL`)
- `bash scripts/push-to-github.sh` — push supabase/ + lib/db/schema/ work to GitHub branch `feat/supabase-schema-alignment`

## Required Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | API server port (set by Replit automatically) |
| `VITE_SUPABASE_URL` | Supabase project URL (frontend) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key (frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (backend only) |
| `SUPABASE_DB_URL` | Supabase project base URL (for management API) |
| `SESSION_SECRET` | Express session signing secret |
| `DATABASE_URL` | Full PostgreSQL connection string (for Drizzle push) |

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM + `drizzle-zod`
- Frontend data: Supabase JS client (`@supabase/supabase-js`)
- Validation: Zod (`zod/v4`)
- Build: esbuild

## Where things live

| Path | Purpose |
|---|---|
| `artifacts/api-server/src/` | Express API server |
| `lib/db/src/schema/` | **Source of truth** — Drizzle table definitions |
| `supabase/migrations/` | SQL migration files (DDL + RLS) |
| `supabase/seed/seed.sql` | Dev/staging seed data |
| `supabase/types.ts` | Generated TypeScript types matching live Supabase schema |
| `supabase/config.toml` | Supabase CLI local config |
| `zamproject-hono-merged.tar.gz` | Archive of the original merged frontend repo |

## Database Tables (Supabase public schema)

All 10 tables already exist in the live Supabase project:

- `badges` — tier badge definitions
- `members` — member profiles (links to `auth.users` via `auth_user_id`)
- `sessions` — custom session tokens
- `otp_codes` — OTP verification codes (service-role only)
- `otp_tokens` — legacy OTP tokens (service-role only)
- `notifications` — per-member notifications
- `upgrade_requests` — tier upgrade submissions
- `profit_distributions` — monthly dividend records
- `tier_change_history` — audit log of tier changes
- `event_bookings` — event reservations

## Architecture decisions

- **Supabase is frontend-only for now** — the Hono/Express backend uses Drizzle ORM directly; Supabase client is only used in the React frontend for auth + real-time queries.
- **RLS is MVP-safe** — all user tables have RLS enabled; members can only access their own rows via `get_my_member_id()` helper function. Service-role key bypasses RLS for backend ops.
- **`VITE_SUPABASE_ANON_KEY` not `PUBLISHABLE_KEY`** — the frontend client uses `VITE_SUPABASE_ANON_KEY`; the old Lovable-generated name (`VITE_SUPABASE_PUBLISHABLE_KEY`) is wrong for this project.
- **Drizzle schema mirrors Supabase** — `lib/db/src/schema/*.ts` is kept in sync with the live Supabase DDL so the Express backend can use the same type-safe models.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `SUPABASE_DB_URL` in Replit Secrets is the Supabase base URL (`https://...supabase.co/`), not a `postgresql://` connection string. For direct SQL access use the Supabase Management API or obtain the `postgresql://` string from Supabase dashboard → Project Settings → Database.
- The api-server reads `PORT` from env — never hardcode a port.
- `git remote add` is blocked in the main agent; use `bash scripts/push-to-github.sh` (runs a fresh clone + push) to push to GitHub.
