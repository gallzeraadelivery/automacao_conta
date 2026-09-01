import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { isValidLicenseKeyFormat, normalizeLicenseKey } from "@uber-automation/license-shared";
import type { LicenseGuard } from "@uber-automation/license-client";

const activateSchema = z.object({
  licenseKey: z.string().min(8),
});

export function createLicenseRouter(getGuard: () => LicenseGuard): Router {
  const router = Router();

  const activateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: "RATE_LIMIT", message: "Muitas tentativas. Aguarde alguns minutos." },
    },
  });

  router.get("/status", (_req, res) => {
    const guard = getGuard();
    res.json({ success: true, data: guard.getStatus() });
  });

  router.post("/activate", activateLimiter, async (req, res, next) => {
    try {
      const guard = getGuard();
      const status = guard.getStatus();
      if (!status.enabled) {
        res.status(400).json({
          success: false,
          error: { code: "LICENSE_DISABLED", message: "Licenca desabilitada nesta instalacao" },
        });
        return;
      }

      const parsed = activateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Chave invalida" },
        });
        return;
      }

      const licenseKey = normalizeLicenseKey(parsed.data.licenseKey);
      if (!isValidLicenseKeyFormat(licenseKey)) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Formato invalido. Use GD-XXXX-XXXX",
          },
        });
        return;
      }

      await guard.activate(licenseKey);
      const nextStatus = guard.getStatus();
      if (!nextStatus.ok) {
        res.status(403).json({
          success: false,
          error: { code: "LICENSE_DENIED", message: nextStatus.message },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          ...nextStatus,
          message: "Licenca ativada com sucesso",
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
