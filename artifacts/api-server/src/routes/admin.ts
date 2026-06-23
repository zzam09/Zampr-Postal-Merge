/**
 * Admin-only routes — requires role = 'admin'.
 *
 * GET   /api/admin/members                         → list all members
 * GET   /api/admin/members/:id                     → get single member
 * GET   /api/admin/upgrade-requests                → all pending requests
 * PATCH /api/admin/upgrade-requests/:id            → approve / reject
 * GET   /api/admin/notifications                   → all notifications
 * POST  /api/admin/members/:id/notify              → push notification to member
 */
import { Router } from "express";
import { sbRest } from "../lib/supabase";
import { requireAuth, loadMember, requireAdmin } from "../middlewares/auth";

const router  = Router();
const isAdmin = [requireAuth, loadMember, requireAdmin] as const;

// ── GET /api/admin/members ────────────────────────────────────────────────────
router.get("/members", ...isAdmin, async (_req, res) => {
  const { ok, data, status } = await sbRest("members", {
    query: "order=created_at.desc",
  });
  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to fetch members", code: "FETCH_FAILED" });
    return;
  }
  res.json({ success: true, data });
});

// ── GET /api/admin/members/:id ────────────────────────────────────────────────
router.get("/members/:id", ...isAdmin, async (req, res) => {
  const { ok, data } = await sbRest("members", {
    query: `id=eq.${req.params["id"]}&limit=1`,
  });
  if (!ok || !Array.isArray(data) || data.length === 0) {
    res.status(404).json({ success: false, error: "Member not found", code: "NOT_FOUND" });
    return;
  }
  res.json({ success: true, data: data[0] });
});

// ── GET /api/admin/upgrade-requests ──────────────────────────────────────────
router.get("/upgrade-requests", ...isAdmin, async (req, res) => {
  const statusFilter = req.query["status"];
  const query = statusFilter
    ? `status=eq.${statusFilter}&order=created_at.desc`
    : "order=created_at.desc";

  const { ok, data, status } = await sbRest("upgrade_requests", { query });
  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to fetch upgrade requests", code: "FETCH_FAILED" });
    return;
  }
  res.json({ success: true, data });
});

// ── PATCH /api/admin/upgrade-requests/:id ────────────────────────────────────
router.patch("/upgrade-requests/:id", ...isAdmin, async (req, res) => {
  const { status: newStatus, admin_notes } = req.body ?? {};

  if (!["APPROVED", "REJECTED"].includes(newStatus)) {
    res.status(400).json({ success: false, error: "status must be APPROVED or REJECTED", code: "VALIDATION_ERROR" });
    return;
  }

  // Fetch the request first to get to_tier
  const { data: existing } = await sbRest("upgrade_requests", {
    query: `id=eq.${req.params["id"]}&limit=1`,
  });
  if (!Array.isArray(existing) || existing.length === 0) {
    res.status(404).json({ success: false, error: "Upgrade request not found", code: "NOT_FOUND" });
    return;
  }

  const ur = existing[0] as Record<string, unknown>;

  // Update the upgrade request
  const { ok, data, status } = await sbRest("upgrade_requests", {
    method: "PATCH",
    query:  `id=eq.${req.params["id"]}`,
    body: {
      status:      newStatus,
      admin_notes: admin_notes ?? null,
      reviewed_by: req.member!["id"],
      reviewed_at: new Date().toISOString(),
    },
    prefer: "return=representation",
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to update request", code: "UPDATE_FAILED" });
    return;
  }

  // If approved, promote the member's tier
  if (newStatus === "APPROVED") {
    await sbRest("members", {
      method: "PATCH",
      query:  `id=eq.${ur["member_id"]}`,
      body:   { tier: ur["to_tier"] },
      prefer: "return=minimal",
    });

    // Write tier_change_history
    await sbRest("tier_change_history", {
      method: "POST",
      body: {
        member_id:     ur["member_id"],
        changed_by:    req.member!["id"],
        previous_tier: ur["from_tier"],
        new_tier:      ur["to_tier"],
      },
      prefer: "return=minimal",
    });
  }

  const updated = Array.isArray(data) ? data[0] : data;
  res.json({ success: true, data: updated });
});

// ── POST /api/admin/members/:id/notify ───────────────────────────────────────
router.post("/members/:id/notify", ...isAdmin, async (req, res) => {
  const { type, title, message } = req.body ?? {};

  if (!type || !title || !message) {
    res.status(400).json({ success: false, error: "type, title, and message are required", code: "VALIDATION_ERROR" });
    return;
  }

  const { ok, data, status } = await sbRest("notifications", {
    method: "POST",
    body: {
      member_id: req.params["id"],
      type,
      title,
      message,
    },
    prefer: "return=representation",
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to send notification", code: "CREATE_FAILED" });
    return;
  }

  const created = Array.isArray(data) ? data[0] : data;
  res.status(201).json({ success: true, data: created });
});

export default router;
