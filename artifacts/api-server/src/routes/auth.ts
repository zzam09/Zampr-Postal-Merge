/**
 * Auth routes — OTP send/verify and session management.
 *
 * POST /api/auth/otp/send       → send OTP email (Supabase magic-link / OTP)
 * POST /api/auth/otp/verify     → verify OTP → return access + refresh tokens
 * DELETE /api/auth/session      → sign out (invalidate token server-side)
 */
import { Router } from "express";
import { SUPABASE_URL, SERVICE_ROLE_KEY, sbRest } from "../lib/supabase";
import { requireAuth, loadMember } from "../middlewares/auth";

const router = Router();

// ── POST /api/auth/otp/send ──────────────────────────────────────────────────
router.post("/otp/send", async (req, res) => {
  const { email } = req.body ?? {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ success: false, error: "Valid email is required", code: "VALIDATION_ERROR" });
    return;
  }

  // Use Supabase OTP (magic link) flow
  const supaRes = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey":        SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ email, create_user: false }),
  });

  if (supaRes.ok) {
    res.json({ success: true, message: "OTP sent to email" });
  } else {
    const err = await supaRes.json().catch(() => ({})) as Record<string, unknown>;
    res.status(500).json({ success: false, error: String(err["msg"] ?? "Failed to send OTP"), code: "OTP_SEND_FAILED" });
  }
});

// ── POST /api/auth/otp/verify ────────────────────────────────────────────────
router.post("/otp/verify", async (req, res) => {
  const { email, token } = req.body ?? {};

  if (!email || !token) {
    res.status(400).json({ success: false, error: "email and token are required", code: "VALIDATION_ERROR" });
    return;
  }

  const supaRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey":        SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ email, token, type: "magiclink" }),
  });

  const data = await supaRes.json() as Record<string, unknown>;

  if (!supaRes.ok) {
    res.status(401).json({ success: false, error: String(data["error_description"] ?? data["msg"] ?? "Invalid OTP"), code: "INVALID_OTP" });
    return;
  }

  res.json({
    success: true,
    data: {
      access_token:  data["access_token"],
      refresh_token: data["refresh_token"],
      expires_in:    data["expires_in"],
      token_type:    "bearer",
    },
  });
});

// ── DELETE /api/auth/session ─────────────────────────────────────────────────
router.delete("/session", requireAuth, loadMember, async (req, res) => {
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.toString().slice(7);

  // Call Supabase logout to invalidate the token
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: {
      "apikey":        SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${token}`,
    },
  });

  // Delete server-side session row if present
  await sbRest("sessions", {
    method: "DELETE",
    query:  `member_id=eq.${req.member!["id"]}`,
  });

  res.json({ success: true, message: "Signed out" });
});

export default router;
