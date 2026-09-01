import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { createDb } from "./db/index.js";
import { LicenseService } from "./services/license.service.js";
import { AuthService } from "./services/auth.service.js";
import { createAdminRouter, createClientRouter } from "./routes/index.js";

const env = loadEnv();
const db = createDb(env.LICENSE_DB_PATH);
const service = new LicenseService(db);
const auth = new AuthService(env);

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", env.LICENSE_CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "license-server" });
});

app.use("/api/v1", createClientRouter(service));
app.use("/api/admin", createAdminRouter(service, auth, env));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.listen(env.PORT, () => {
  console.log(`[license-server] listening on :${env.PORT} (db=${env.LICENSE_DB_PATH})`);
});
