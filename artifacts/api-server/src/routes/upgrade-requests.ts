/**
 * Upgrade request routes — auth required.
 *
 * GET  /api/upgrade-requests      → own requests
 * POST /api/upgrade-requests      → submit new request
 * GET  /api/upgrade-requests/:id  → get single request
 */
import { Router } from "express";
import { sbRest } from "../lib/supabase";
import { requireAuth, loadMember } from "../middlewares/auth";

const router = Router();
const auth   = [requireAuth, loadMember] as const;

const VALID_TIERS = ["Explorer", "Pioneer", "Vanguard"] as const;
type Tier = typeof VALID_TIERS[number];

// ── GET /api/upgrade-requests ─────────────────────────────────────────────────
router.get("/", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;
  const { ok, data, status } = await sbRest("upgrade_requests", {
    query: `member_id=eq.${memberId}&order=created_at.desc`,
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to fetch upgrade requests", code: "FETCH_FAILED" });
    return;
  }

  res.json({ success: true, data });
});

// ── POST /api/upgrade-requests ────────────────────────────────────────────────
router.post("/", ...auth, async (req, res) => {
  const { to_tier, payment_reference } = req.body ?? {};
  const member = req.member!;

  if (!to_tier || !VALID_TIERS.includes(to_tier as Tier)) {
    res.status(400).json({
      success: false,
      error:   `to_tier must be one of: ${VALID_TIERS.join(", ")}`,
      code:    "VALIDATION_ERROR",
    });
    return;
  }

  if (to_tier === member["tier"]) {
    res.status(400).json({ success: false, error: "Already on this tier", code: "SAME_TIER" });
    return;
  }

  // Check for pending request
  const { data: pending } = await sbRest("upgrade_requests", {
    query: `member_id=eq.${member["id"]}&status=eq.PENDING&limit=1`,
  });

  if (Array.isArray(pending) && pending.length > 0) {
    res.status(409).json({ success: false, error: "You already have a pending upgrade request", code: "PENDING_EXISTS" });
    return;
  }

  const { ok, data, status } = await sbRest("upgrade_requests", {
    method: "POST",
    body: {
      member_id:         member["id"],
      from_tier:         member["tier"],
      to_tier,
      payment_reference: payment_reference ?? null,
      status:            "PENDING",
    },
    prefer: "return=representation",
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to submit upgrade request", code: "CREATE_FAILED" });
    return;
  }

  const created = Array.isArray(data) ? data[0] : data;
  res.status(201).json({ success: true, data: created });
});

// ── GET /api/upgrade-requests/:id ────────────────────────────────────────────
router.get("/:id", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;
  const { ok, data } = await sbRest("upgrade_requests", {
    query: `id=eq.${req.params["id"]}&member_id=eq.${memberId}&limit=1`,
  });

  if (!ok || !Array.isArray(data) || data.length === 0) {
    res.status(404).json({ success: false, error: "Upgrade request not found", code: "NOT_FOUND" });
    return;
  }

  res.json({ success: true, data: data[0] });
});

export default router;
