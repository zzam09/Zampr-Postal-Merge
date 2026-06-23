/**
 * Payment / profit distribution history — auth required.
 *
 * GET /api/history       → own profit distribution records
 * GET /api/history/:id   → single record
 */
import { Router } from "express";
import { sbRest } from "../lib/supabase";
import { requireAuth, loadMember } from "../middlewares/auth";

const router = Router();
const auth   = [requireAuth, loadMember] as const;

// ── GET /api/history ──────────────────────────────────────────────────────────
router.get("/", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;
  const { ok, data, status } = await sbRest("profit_distributions", {
    query: `member_id=eq.${memberId}&order=period_month.desc`,
  });

  if (!ok) {
    res.status(status).json({ success: false, error: "Failed to fetch history", code: "FETCH_FAILED" });
    return;
  }

  res.json({ success: true, data });
});

// ── GET /api/history/:id ──────────────────────────────────────────────────────
router.get("/:id", ...auth, async (req, res) => {
  const memberId = req.member!["id"] as string;
  const { ok, data } = await sbRest("profit_distributions", {
    query: `id=eq.${req.params["id"]}&member_id=eq.${memberId}&limit=1`,
  });

  if (!ok || !Array.isArray(data) || data.length === 0) {
    res.status(404).json({ success: false, error: "Record not found", code: "NOT_FOUND" });
    return;
  }

  res.json({ success: true, data: data[0] });
});

export default router;
