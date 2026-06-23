/**
 * Notification routes — auth required.
 *
 * GET    /api/notifications           → list own notifications
 * PATCH  /api/notifications/read-all  → mark all as read
 * PATCH  /api/notifications/:id/read  → mark one as read
 * GET    /api/notifications/:id       → get single notification
 */
import { Router } from "express";
import { sbRest } from "../lib/supabase";
import { requireAuth, loadMember } from "../middlewares/auth";

const router = Router();
const auth   = [requireAuth, loadMember] as const;

// ── GET /api/notifications ────────────────────────────────────────────────────
router.get("/", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;
  const { ok, data, status } = await sbRest("notifications", {
    query: `member_id=eq.${memberId}&order=created_at.desc`,
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to fetch notifications", code: "FETCH_FAILED" });
    return;
  }

  res.json({ success: true, data });
});

// ── GET /api/notifications/:id ────────────────────────────────────────────────
router.get("/:id", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;
  const { ok, data } = await sbRest("notifications", {
    query: `id=eq.${req.params["id"]}&member_id=eq.${memberId}&limit=1`,
  });

  if (!ok || !Array.isArray(data) || data.length === 0) {
    res.status(404).json({ success: false, error: "Notification not found", code: "NOT_FOUND" });
    return;
  }

  res.json({ success: true, data: data[0] });
});

// ── PATCH /api/notifications/read-all ────────────────────────────────────────
// Must be defined BEFORE /:id to avoid "read-all" matching as an ID param
router.patch("/read-all", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;
  const { ok, status } = await sbRest("notifications", {
    method: "PATCH",
    query:  `member_id=eq.${memberId}&read=eq.false`,
    body:   { read: true },
    prefer: "return=minimal",
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to update notifications", code: "UPDATE_FAILED" });
    return;
  }

  res.json({ success: true, message: "All notifications marked as read" });
});

// ── PATCH /api/notifications/:id/read ────────────────────────────────────────
router.patch("/:id/read", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;

  // Verify ownership first
  const { data: existing } = await sbRest("notifications", {
    query: `id=eq.${req.params["id"]}&member_id=eq.${memberId}&limit=1`,
  });

  if (!Array.isArray(existing) || existing.length === 0) {
    res.status(404).json({ success: false, error: "Notification not found", code: "NOT_FOUND" });
    return;
  }

  const { ok, data, status } = await sbRest("notifications", {
    method: "PATCH",
    query:  `id=eq.${req.params["id"]}&member_id=eq.${memberId}`,
    body:   { read: true },
    prefer: "return=representation",
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to mark notification as read", code: "UPDATE_FAILED" });
    return;
  }

  const updated = Array.isArray(data) ? data[0] : data;
  res.json({ success: true, data: updated });
});

export default router;
