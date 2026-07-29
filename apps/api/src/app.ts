import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./env";
import { authRouter } from "./routes/auth.routes";
import { applicantsRouter } from "./routes/applicants.routes";
import { emailAccountsRouter } from "./routes/emailAccounts.routes";
import { proxiesRouter } from "./routes/proxies.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
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

  app.use("/api/auth", authRouter);
  app.use("/api/applicants", applicantsRouter);
  app.use("/api/email-accounts", emailAccountsRouter);
  app.use("/api/proxies", proxiesRouter);
  app.use("/api/dashboard", dashboardRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
