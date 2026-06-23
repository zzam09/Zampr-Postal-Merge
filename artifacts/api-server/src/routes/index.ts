import { Router, type IRouter } from "express";
import healthRouter         from "./health";
import authRouter           from "./auth";
import membersRouter        from "./members";
import tiersRouter          from "./tiers";
import notificationsRouter  from "./notifications";
import upgradeRequestsRouter from "./upgrade-requests";
import historyRouter        from "./history";
import adminRouter          from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth",             authRouter);
router.use("/members",          membersRouter);
router.use("/tiers",            tiersRouter);
router.use("/notifications",    notificationsRouter);
router.use("/upgrade-requests", upgradeRequestsRouter);
router.use("/history",          historyRouter);
router.use("/admin",            adminRouter);

export default router;
