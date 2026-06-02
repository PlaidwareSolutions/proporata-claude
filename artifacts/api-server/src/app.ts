import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { stripeWebhookHandler } from "./lib/stripeWebhook";

const app: Express = express();

// Health probe MUST be the simplest possible code path so the Cloud Run
// startup probe can never be tripped up by middleware, body parsing, auth,
// or anything else. Mount it before everything else.
app.get("/api/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

// Stripe webhook MUST receive the raw body for signature verification.
// Mount BEFORE express.json().
app.post(
  "/api/integrations/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);

// Serve the hoa-hub SPA at /app when running in production (Railway).
// In dev, the Vite dev server serves it on its own port with HMR.
if (process.env.NODE_ENV === "production") {
  const hoaHubDist = path.join(process.cwd(), "artifacts/hoa-hub/dist/public");
  app.use("/app", express.static(hoaHubDist));
  // SPA fallback — all /app/* routes return index.html so client-side routing works
  app.get("/app/*path", (_req, res) => {
    res.sendFile(path.join(hoaHubDist, "index.html"));
  });
}

export default app;
