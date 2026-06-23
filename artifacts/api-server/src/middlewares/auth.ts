import type { Request, Response, NextFunction } from "express";
import { verifyJwt, sbRest } from "../lib/supabase";

// Augment Express Request with auth context
declare global {
  namespace Express {
    interface Request {
      authUser?: Record<string, unknown>;
      member?:   Record<string, unknown>;
    }
  }
}

// ── requireAuth ───────────────────────────────────────────────────────────────
// Verifies the Bearer JWT from Supabase Auth.
// Attaches req.authUser = { id, email, ... } from Supabase Auth.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Missing or malformed Authorization header", code: "UNAUTHORIZED" });
    return;
  }

  const token = header.slice(7);
  const user = await verifyJwt(token);

  if (!user || !user["id"]) {
    res.status(401).json({ success: false, error: "Invalid or expired token", code: "UNAUTHORIZED" });
    return;
  }

  req.authUser = user;
  next();
}

// ── loadMember ────────────────────────────────────────────────────────────────
// After requireAuth, looks up the members row by auth_user_id.
// Attaches req.member or returns 404 if not provisioned yet.
export async function loadMember(req: Request, res: Response, next: NextFunction) {
  const userId = req.authUser?.["id"] as string;
  const { ok, data } = await sbRest("members", {
    query: `auth_user_id=eq.${userId}&limit=1`,
  });

  if (!ok || !Array.isArray(data) || data.length === 0) {
    res.status(404).json({ success: false, error: "Member profile not found", code: "MEMBER_NOT_FOUND" });
    return;
  }

  req.member = data[0] as Record<string, unknown>;
  next();
}

// ── requireAdmin ──────────────────────────────────────────────────────────────
// Must run after loadMember. Returns 403 if role != 'admin'.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.member?.["role"] !== "admin") {
    res.status(403).json({ success: false, error: "Admin access required", code: "FORBIDDEN" });
    return;
  }
  next();
}
