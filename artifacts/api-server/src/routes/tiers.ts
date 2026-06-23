/**
 * Tiers — public, no auth required.
 *
 * GET /api/tiers   → list all membership tiers
 */
import { Router } from "express";

const router = Router();

const TIERS = [
  {
    id:          "tier-ex",
    name:        "Explorer",
    price:       "$1,500",
    priceValue:  1500,
    clearance:   "Clearance Level 1",
    description: "Entry-level intelligence and ecosystem access for mission observers.",
    features: [
      "Weekly mission intelligence briefings",
      "Digital VIP credentials & member badge",
      "Basic profit distribution participation (0.5% base)",
      "Invitation to public SpaceX launch viewings",
    ],
    benefits: [
      "Weekly mission intelligence briefings",
      "Digital VIP credentials & member badge",
      "SpaceX launch viewing invitations",
    ],
    variant: "explorer",
  },
  {
    id:          "tier-pi",
    name:        "Pioneer",
    price:       "$4,000",
    priceValue:  4000,
    clearance:   "Clearance Level 2",
    description: "Advanced operational access with guaranteed presence at major hardware reveals.",
    features: [
      "Guaranteed VIP Passes to Tesla AI Day & Robotaxi events",
      "3× Enhanced monthly profit dividends (1.5% base)",
      "Priority seating at Starbase launch events",
      "Access to Private Member Discord for Alpha news",
    ],
    benefits: [
      "Guaranteed VIP passes to Tesla events",
      "3× Enhanced monthly profit dividends",
      "Priority seating at Starbase events",
      "Private Member Discord access",
    ],
    variant: "pioneer",
  },
  {
    id:          "tier-va",
    name:        "Vanguard",
    price:       "$6,000",
    priceValue:  6000,
    clearance:   "Full Operational Clearance",
    description: "The inner circle. Direct engagement with leadership and maximum ecosystem yields.",
    features: [
      "Private 1-on-1 Strategy Meeting with Elon Musk",
      "Maximum monthly profit dividend tier (3.5% target)",
      "Vanguard Council mission voting rights",
      "Lifetime VIP access to Starbase Launch Control",
      "Limited Edition Titanium Physical Membership Card",
    ],
    benefits: [
      "Private 1-on-1 with Elon Musk",
      "Maximum monthly profit dividend tier",
      "Vanguard Council voting rights",
      "Lifetime VIP Starbase access",
    ],
    variant: "vanguard",
  },
];

router.get("/", (_req, res) => {
  res.json({ success: true, data: TIERS });
});

router.get("/:id", (req, res) => {
  const tier = TIERS.find((t) => t.id === req.params["id"]);
  if (!tier) {
    res.status(404).json({ success: false, error: "Tier not found", code: "NOT_FOUND" });
    return;
  }
  res.json({ success: true, data: tier });
});

export default router;
