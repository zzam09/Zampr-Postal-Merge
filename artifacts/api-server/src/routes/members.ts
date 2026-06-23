/**
 * Member profile routes.
 *
 * GET   /api/members/me   → own profile
 * PATCH /api/members/me   → update name / avatar_url / location
 */
import { Router } from "express";
import { sbRest } from "../lib/supabase";
import { requireAuth, loadMember } from "../middlewares/auth";

const router = Router();

// ── GET /api/members/me ───────────────────────────────────────────────────────
router.get("/me", requireAuth, loadMember, (req, res) => {
  const m = req.member!;
  res.json({
    success: true,
    data: {
      id:            m["id"],
      email:         m["email"],
      name:          m["name"],
      tier:          m["tier"],
      status:        m["status"],
      role:          m["role"],
      clearance:     m["clearance"],
      title:         m["title"],
      location:      m["location"],
      member_since:  m["member_since"],
      avatar_url:    m["avatar_url"],
      display_level: m["display_level"],
      badge_id:      m["badge_id"],
      created_at:    m["created_at"],
    },
  });
});

// ── PATCH /api/members/me ─────────────────────────────────────────────────────
router.patch("/me", requireAuth, loadMember, async (req, res) => {
  const ALLOWED = ["name", "avatar_url", "location", "title"] as const;
  const updates: Record<string, unknown> = {};

  for (const field of ALLOWED) {
    if (field in (req.body ?? {})) {
      const val = req.body[field];
      if (val !== null && typeof val !== "string") {
        res.status(400).json({ success: false, error: `${field} must be a string`, code: "VALIDATION_ERROR" });
        return;
      }
      updates[field] = val;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ success: false, error: "No updatable fields provided", code: "VALIDATION_ERROR" });
    return;
  }

  const { ok, data, status } = await sbRest("members", {
    method: "PATCH",
    query:  `id=eq.${req.member!["id"]}`,
    body:   updates,
    prefer: "return=representation",
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to update profile", code: "UPDATE_FAILED" });
    return;
  }

  const updated = Array.isArray(data) ? data[0] : data;
  res.json({ success: true, data: updated });
});

export default router;
