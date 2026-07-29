import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env";
import { createSessionMiddleware } from "./session";
import { flowRouter } from "./routes/flow.routes";
import { scenariosRouter } from "./routes/scenarios.routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(createSessionMiddleware(env.MOCK_SESSION_SECRET));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));

  app.use("/mock-uber", flowRouter);
  app.use("/mock-uber", scenariosRouter);

  app.use((_req, res) => {
    res.status(404).send("Página não encontrada neste ambiente de teste (mock-uber).");
  });

  return app;
}
