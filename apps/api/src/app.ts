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
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp(): Express {
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
