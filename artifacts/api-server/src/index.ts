import app from "./app";
import { logger } from "./lib/logger";
import { startInsuranceScheduler } from "./lib/insuranceScheduler";
import { startAccScheduler } from "./lib/accScheduler";
import { startBidScheduler } from "./lib/bidScheduler";
import { startMotionScheduler } from "./lib/motionScheduler";
import { startCalendarSchedulers } from "./lib/calendarScheduler";
import { bootstrapAmenities } from "./lib/amenitiesBootstrap";
import { startAmenityScheduler } from "./lib/amenityScheduler";
import { startChargingScheduler } from "./lib/chargingScheduler";
import { startPackagesAgingScheduler } from "./lib/packagesAging";
import { startPetScheduler } from "./lib/petScheduler";
import { startStripeAutoPayScheduler } from "./lib/stripeAutoPayScheduler";
import { startOcrScheduler } from "./lib/ocrScheduler";
import { startMembershipScheduler } from "./lib/membershipScheduler";
import { logStripeWarning, refreshStripeConfig } from "./lib/stripe";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Wrap a synchronous scheduler-start call so that one scheduler failing to
// initialize does not prevent the others from starting. Logs an explicit
// success/failure line so any future boot regression is diagnosable from
// the deployment logs alone.
function safeStart(name: string, fn: () => void): void {
  try {
    fn();
    logger.info({ scheduler: name }, `scheduler ${name} started`);
  } catch (err) {
    logger.error(
      { err, scheduler: name },
      `scheduler ${name} failed to start`,
    );
  }
}

// Bind explicitly to 0.0.0.0 (IPv4 all-interfaces). Without an explicit host,
// Node may bind dual-stack on "::" only, and some Cloud Run configurations
// send the startup probe over IPv4 loopback — the probe never reaches the
// listener, the autoscale promote step times out, and the deploy fails with
// "app built successfully but failed to start".
app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host: "0.0.0.0" }, "Server listening");

  safeStart("insurance", startInsuranceScheduler);
  safeStart("ocr", startOcrScheduler);
  safeStart("acc", startAccScheduler);
  safeStart("bid", startBidScheduler);
  safeStart("motion", startMotionScheduler);
  safeStart("calendar", startCalendarSchedulers);
  safeStart("membership", startMembershipScheduler);

  bootstrapAmenities()
    .then(() => {
      safeStart("amenity", startAmenityScheduler);
      safeStart("charging", startChargingScheduler);
      safeStart("packagesAging", startPackagesAgingScheduler);
      safeStart("pet", startPetScheduler);
    })
    .catch((bootstrapErr) => {
      logger.error({ err: bootstrapErr }, "Amenities bootstrap failed");
    });

  refreshStripeConfig()
    .then(() => {
      logStripeWarning();
      safeStart("stripeAutoPay", startStripeAutoPayScheduler);
    })
    .catch((stripeErr) => {
      logger.error(
        { err: stripeErr },
        "Failed to load Stripe config; continuing with env values",
      );
      logStripeWarning();
      safeStart("stripeAutoPay", startStripeAutoPayScheduler);
    });
});
