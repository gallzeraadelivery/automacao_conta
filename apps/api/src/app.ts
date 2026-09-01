import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { env } from "./env";
import { loadOpenApiSpec } from "./lib/openapi";
import { authRouter } from "./routes/auth.routes";
import { applicantsRouter } from "./routes/applicants.routes";
import { emailAccountsRouter } from "./routes/emailAccounts.routes";
import { proxiesRouter } from "./routes/proxies.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { pendingActionsRouter } from "./routes/pendingActions.routes";
import { deliveriesRouter } from "./routes/deliveries.routes";
import { reportsRouter } from "./routes/reports.routes";
import { settingsRouter } from "./routes/settings.routes";
import { createLicenseRouter } from "./routes/license.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import type { LicenseGuard } from "@uber-automation/license-client";

export interface CreateAppOptions {
  assertLicensed?: () => void;
  getLicenseGuard?: () => LicenseGuard;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.API_CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));

  if (options.getLicenseGuard) {
    app.use("/api/license", createLicenseRouter(options.getLicenseGuard));
  }

  if (options.assertLicensed) {
    app.use((req, res, next) => {
      if (req.path === "/health" || req.path.startsWith("/api/license")) {
        next();
        return;
      }
      try {
        options.assertLicensed!();
        next();
      } catch (error) {
        const message = (error as Error).message || "Licenca invalida ou revogada";
        const code = message === "LICENSE_REQUIRED" ? "LICENSE_REQUIRED" : "LICENSE_DENIED";
        res.status(403).json({
          success: false,
          error: { code, message },
        });
      }
    });
  }

  // Documentação interativa (Swagger UI) - sem autenticação, é apenas
  // documentação estática da própria API (nenhum dado de motorista/empresa).
  app.get("/api/openapi.json", (_req, res) => res.json(loadOpenApiSpec()));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(loadOpenApiSpec()));

  app.use("/api/auth", authRouter);
  app.use("/api/applicants", applicantsRouter);
  app.use("/api/email-accounts", emailAccountsRouter);
  app.use("/api/proxies", proxiesRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/pending-actions", pendingActionsRouter);
  app.use("/api/deliveries", deliveriesRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/settings", settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
