import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { LicenseService } from "../services/license.service.js";
import type { AuthService } from "../services/auth.service.js";
import type { Env } from "../env.js";

const SESSION_COOKIE = "license_admin_session";

function readSessionToken(req: Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

function sessionAuth(auth: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!auth.verifySessionToken(readSessionToken(req))) {
      res.status(401).json({ success: false, error: { message: "Sessão expirada ou inválida" } });
      return;
    }
    next();
  };
}

export function createAdminRouter(service: LicenseService, auth: AuthService, env: Env) {
  const router = Router();

  router.post("/auth/login", (req, res) => {
    const body = z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
      .parse(req.body);

    if (!auth.verifyCredentials(body.username, body.password)) {
      res.status(401).json({ success: false, error: { message: "Usuário ou senha inválidos" } });
      return;
    }

    const token = auth.createSessionToken();
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: auth.sessionMaxAgeMs(),
      path: "/",
    });
    res.json({ success: true, data: { username: env.LICENSE_ADMIN_USER } });
  });

  router.post("/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ success: true, data: { ok: true } });
  });

  router.get("/auth/me", (req, res) => {
    if (!auth.verifySessionToken(readSessionToken(req))) {
      res.status(401).json({ success: false, error: { message: "Não autenticado" } });
      return;
    }
    res.json({ success: true, data: { username: env.LICENSE_ADMIN_USER } });
  });

  router.use(sessionAuth(auth));

  router.get("/licenses", (_req, res) => {
    res.json({ success: true, data: service.listLicenses() });
  });

  router.post("/licenses", (req, res) => {
    const body = z
      .object({
        label: z.string().optional(),
        maxMachines: z.coerce.number().int().min(0).optional(),
        expiresAt: z.string().nullable().optional(),
      })
      .parse(req.body);
    const license = service.createLicense(body);
    res.status(201).json({ success: true, data: license });
  });

  router.patch("/licenses/:licenseKey", (req, res) => {
    try {
      const body = z
        .object({
          label: z.string().nullable().optional(),
          maxMachines: z.coerce.number().int().min(0).optional(),
        })
        .parse(req.body);
      const data = service.updateLicense(req.params.licenseKey, body);
      res.json({ success: true, data });
    } catch (err) {
      res.status(404).json({ success: false, error: { message: (err as Error).message } });
    }
  });

  router.get("/licenses/:licenseKey/activations", (req, res) => {
    try {
      const data = service.listActivations(req.params.licenseKey);
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: (err as Error).message } });
    }
  });

  router.post("/licenses/:licenseKey/revoke", (req, res) => {
    try {
      const data = service.setLicenseStatus(req.params.licenseKey, "revoked");
      res.json({ success: true, data });
    } catch (err) {
      res.status(404).json({ success: false, error: { message: (err as Error).message } });
    }
  });

  router.post("/licenses/:licenseKey/activate", (req, res) => {
    try {
      const data = service.setLicenseStatus(req.params.licenseKey, "active");
      res.json({ success: true, data });
    } catch (err) {
      res.status(404).json({ success: false, error: { message: (err as Error).message } });
    }
  });

  router.delete("/licenses/:licenseKey/activations/:machineId", (req, res) => {
    try {
      const data = service.removeActivation(req.params.licenseKey, req.params.machineId);
      res.json({ success: true, data });
    } catch (err) {
      res.status(404).json({ success: false, error: { message: (err as Error).message } });
    }
  });

  return router;
}

export function createClientRouter(service: LicenseService) {
  const router = Router();

  router.post("/activate", (req, res) => {
    const body = z
      .object({
        licenseKey: z.string(),
        machineId: z.string().min(8),
        hostname: z.string().min(1),
        platform: z.string().optional(),
        appVersion: z.string().optional(),
      })
      .parse(req.body);
    const data = service.activate(body);
    res.json({ success: true, data });
  });

  router.post("/heartbeat", (req, res) => {
    const body = z
      .object({
        licenseKey: z.string(),
        machineId: z.string().min(8),
      })
      .parse(req.body);
    const data = service.heartbeat(body);
    res.json({ success: true, data });
  });

  router.get("/status", (req, res) => {
    const query = z
      .object({
        licenseKey: z.string(),
        machineId: z.string().min(8),
      })
      .parse(req.query);
    const data = service.status(query);
    res.json({ success: true, data });
  });

  return router;
}
