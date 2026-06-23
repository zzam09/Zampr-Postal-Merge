/**
 * Supabase REST/Auth helpers for the server-side Express API.
 * Uses service-role key — bypasses RLS. Never expose this key to clients.
 */

const SUPABASE_URL        = process.env["VITE_SUPABASE_URL"]!;
const SERVICE_ROLE_KEY    = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

// ── Auth headers ─────────────────────────────────────────────────────────────
export const serviceHeaders = () => ({
  "Content-Type": "application/json",
  "apikey":        SERVICE_ROLE_KEY,
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
});

// ── Verify a user-supplied JWT; returns the Supabase user object or null ─────
export async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey":        SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json() as Promise<Record<string, unknown>>;
}

// ── REST helpers ─────────────────────────────────────────────────────────────
type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function sbRest(
  table: string,
  {
    method = "GET",
    query  = "",
    body,
    prefer,
  }: { method?: Method; query?: string; body?: unknown; prefer?: string } = {}
) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const headers: Record<string, string> = {
    ...serviceHeaders(),
    "Prefer": prefer ?? (method === "GET" ? "count=exact" : "return=representation"),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }

  return { status: res.status, ok: res.ok, data: json };
}

// ── Create an auth user via the Admin API ─────────────────────────────────────
export async function createAuthUser(email: string, password: string, metadata?: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata ?? {} }),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Delete an auth user via the Admin API ─────────────────────────────────────
export async function deleteAuthUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: serviceHeaders(),
  });
}

export { SUPABASE_URL, SERVICE_ROLE_KEY };
