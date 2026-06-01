import { Router, type IRouter } from "express";
import healthRouter from "./health";
import buildingsRouter from "./buildings";
import unitsRouter, { unitsReadRouter } from "./units";
import workOrdersRouter from "./workOrders";
import insuranceRouter, { insuranceReadRouter } from "./insurance";
import buildingSystemsRouter, { buildingSystemsReadRouter } from "./buildingSystems";
import documentsRouter from "./documents";
import settingsRouter from "./settings";
import authRouter from "./auth";
import meRouter from "./me";
import storageRouter, { storagePublicRouter, storageReadRouter } from "./storage";
import integrationsRouter from "./integrations";
import notificationsRouter from "./notifications";
import communicationsRouter from "./communications";
import announcementsRouter from "./announcements";
import reportsRouter from "./reports";
import budgetsRouter from "./budgets";
import vendorsRouter from "./vendors";
import architecturalRequestsRouter from "./architecturalRequests";
import billingRouter from "./billing";
import bidsRouter, { bidPublicRouter } from "./bids";
import paymentsRouter from "./payments";
import stripeConfigRouter from "./stripeConfig";
import motionsRouter from "./motions";
import resolutionsRouter from "./resolutions";
import governanceRouter from "./governance";
import calendarRouter, { calendarPublicRouter } from "./calendar";
import meetingsRouter from "./meetings";
import financialRouter from "./financial";
import complianceRouter from "./compliance";
import boardOwnerRouter from "./boardOwner";
import membersRouter from "./members";
import amenitiesRouter from "./amenities";
import committeesRouter from "./committees";
import electionCyclesRouter from "./electionCycles";
import inspectionsRouter from "./inspections";
import lifecycleItemsRouter from "./lifecycleItems";
import vendorContractsRouter from "./vendorContracts";
import vendorCertificatesRouter from "./vendorCertificates";
import chargingRouter from "./charging";
import amenityAccessRouter from "./amenityAccess";
import amenityInspectionsRouter from "./amenityInspections";
import guestParkingRouter, { guestParkingPublicRouter } from "./guestParking";
import packagesRouter from "./packages";
import petsRouter from "./pets";
import amenityComplianceRouter from "./amenityCompliance";
import amenityFinancialsRouter from "./amenityFinancials";
import glossaryRouter from "./glossary";
import { authenticateJwt, requireAdmin, requireManager, requireNotResident } from "../middleware/auth";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(meRouter);
router.use(boardOwnerRouter);
router.use(bidPublicRouter);
router.use(storagePublicRouter);
router.use(calendarPublicRouter);
router.use(guestParkingPublicRouter);
router.use(motionsRouter);
router.use(meetingsRouter);

// `router.use(mw, subRouter)` runs `mw` on EVERY request whose path
// matches the mount path (here, "/"), regardless of whether subRouter
// has a matching route. So `router.use(authenticateJwt, requireAdmin,
// integrationsRouter)` would 403 every non-admin request to /api/*
// before any later route could see it. Scope the admin gate to the
// /integrations prefix and mount the router separately.
router.use("/integrations", authenticateJwt, requireAdmin);
router.use(integrationsRouter);
router.use(authenticateJwt, requireNotResident, buildingsRouter);
// Resident-readable read for the user's own unit (Task #135) — must be
// mounted before the manager-gated unitsRouter so residents aren't 403'd.
router.use(authenticateJwt, unitsReadRouter);
router.use(authenticateJwt, requireNotResident, unitsRouter);
// Owner-readable GETs first (Task #120) — same paths but no manager gate.
router.use(authenticateJwt, insuranceReadRouter);
router.use(authenticateJwt, buildingSystemsReadRouter);
router.use(authenticateJwt, requireNotResident, insuranceRouter);
router.use(authenticateJwt, requireManager, buildingSystemsRouter);
router.use(authenticateJwt, requireManager, settingsRouter);
router.use(membersRouter);
router.use(authenticateJwt, requireManager, vendorsRouter);
router.use(authenticateJwt, storageReadRouter);
router.use(authenticateJwt, requireManager, storageRouter);
router.use(authenticateJwt, requireNotResident, reportsRouter);
router.use(budgetsRouter);
router.use(authenticateJwt, billingRouter);
router.use(authenticateJwt, paymentsRouter);
router.use(stripeConfigRouter);
router.use(authenticateJwt, workOrdersRouter);
router.use(authenticateJwt, documentsRouter);
router.use(authenticateJwt, notificationsRouter);
router.use(authenticateJwt, communicationsRouter);
router.use(authenticateJwt, announcementsRouter);
router.use(architecturalRequestsRouter);
router.use(authenticateJwt, requireManager, bidsRouter);
router.use(resolutionsRouter);
router.use(governanceRouter);
router.use(authenticateJwt, calendarRouter);
router.use(financialRouter);
router.use(complianceRouter);
router.use(authenticateJwt, amenitiesRouter);
router.use(committeesRouter);
router.use(electionCyclesRouter);
router.use(inspectionsRouter);
router.use(lifecycleItemsRouter);
router.use(vendorContractsRouter);
router.use(vendorCertificatesRouter);
router.use(authenticateJwt, chargingRouter);
router.use(authenticateJwt, amenityAccessRouter);
router.use(authenticateJwt, amenityInspectionsRouter);
router.use(authenticateJwt, guestParkingRouter);
router.use(authenticateJwt, packagesRouter);
router.use(authenticateJwt, petsRouter);
router.use(authenticateJwt, amenityComplianceRouter);
router.use(authenticateJwt, amenityFinancialsRouter);
router.use(glossaryRouter);

export default router;
