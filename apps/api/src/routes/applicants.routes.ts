import { Router } from "express";
import { z } from "zod";
import { APPLICANT_STATUSES } from "@uber-automation/database";
import { authenticate, requireRole } from "../middleware/auth";
import { uploadSpreadsheet } from "../middleware/upload";
import { HttpError } from "../middleware/errorHandler";
import { parseSpreadsheetBuffer } from "../lib/parseSpreadsheet";
import {
  validateApplicantImport,
  importApplicants,
  listApplicants,
  getApplicantById,
  startAutomation,
  startAutomationBatch,
  deleteApplicant,
  purgeVeriffApplicants,
  getUberCookiesExport,
  setCookiesDownloaded,
  exportUberCookiesZip,
  openManualBrowser,
  closeManualBrowser,
  stopAutomation,
  stopAllAutomations,
} from "../services/applicants.service";
import { validateEmailListImport, importEmailList } from "../services/emailListImport.service";
import { generateAndEnqueueBatch } from "../services/generateBatch.service";
import { logAudit } from "../services/auditLog.service";

export const applicantsRouter = Router();

applicantsRouter.use(authenticate);

applicantsRouter.post(
  "/validate-import",
  requireRole("admin", "operator"),
  uploadSpreadsheet.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, "MISSING_FILE", "Envie um arquivo no campo 'file'");
      }
      const rows = parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
      const result = await validateApplicantImport(req.user!.companyId, rows);
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

applicantsRouter.post(
  "/import",
  requireRole("admin", "operator"),
  uploadSpreadsheet.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, "MISSING_FILE", "Envie um arquivo no campo 'file'");
      }
      const rows = parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
      const result = await importApplicants(req.user!.companyId, rows);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "import_applicants",
        metadata: { imported: result.imported, skipped: result.skipped },
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

const emailListImportSchema = z.object({
  text: z.string().min(1, "Cole ao menos uma linha no formato email|senha"),
  provider: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value) => (value === "" || value === undefined ? "gmail" : value.toLowerCase())),
});

applicantsRouter.post(
  "/validate-email-list-import",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const { text } = emailListImportSchema.parse(req.body);
      const result = await validateEmailListImport(req.user!.companyId, text);
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

applicantsRouter.post(
  "/email-list-import",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const { text, provider } = emailListImportSchema.parse(req.body);
      const result = await importEmailList(req.user!.companyId, text, { provider });

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "import_email_list",
        metadata: { imported: result.imported, skipped: result.skipped, provider },
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

const emptyToUndef = (value: unknown) =>
  value === "" || value === undefined || value === null ? undefined : value;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.preprocess(emptyToUndef, z.enum(APPLICANT_STATUSES).optional()),
  pauseReason: z.preprocess(emptyToUndef, z.string().trim().min(1).max(80).optional()),
  q: z.preprocess(emptyToUndef, z.string().trim().min(1).max(120).optional()),
});

applicantsRouter.get("/", async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await listApplicants(req.user!.companyId, query);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

const startAutomationBatchSchema = z.object({
  platformPassword: z.string().min(1, "Informe a senha de login da plataforma"),
  applicantIds: z.array(z.string().uuid()).optional(),
});

const generateBatchSchema = z.object({
  count: z.coerce.number().int().min(1).max(100),
});

/**
 * Gera N e-mails @mailsproton.com inéditos, importa e enfileira nos proxies ACTIVE.
 * Senha Uber = Sobrenome@2026 (por motorista).
 */
applicantsRouter.post(
  "/generate-batch",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const input = generateBatchSchema.parse(req.body);
      const result = await generateAndEnqueueBatch(req.user!.companyId, input.count);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "automation_generate_batch_requested",
        metadata: {
          requested: result.requested,
          imported: result.imported,
          enqueued: result.enqueued.length,
          skipped: result.skipped.length,
          activeProxyCount: result.activeProxyCount,
          applicantIds: result.enqueued.map((e) => e.applicantId),
        },
      });

      return res.status(202).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * Start em massa: rodízio dos proxies ACTIVE; fila processa conforme
 * WORKER_CONCURRENCY (recomendado = 1).
 */
applicantsRouter.post(
  "/start-batch",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const input = startAutomationBatchSchema.parse(req.body);
      const result = await startAutomationBatch(req.user!.companyId, input);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "automation_batch_start_requested",
        metadata: {
          enqueued: result.enqueued.length,
          skipped: result.skipped.length,
          activeProxyCount: result.activeProxyCount,
          applicantIds: result.enqueued.map((e) => e.applicantId),
        },
      });

      return res.status(202).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * Para todas as automações da empresa: drena a fila e sinaliza browsers ativos.
 */
applicantsRouter.post(
  "/stop-all",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const result = await stopAllAutomations(req.user!.companyId);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "automation_stop_all_requested",
        metadata: result,
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

applicantsRouter.post(
  "/purge-veriff",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const result = await purgeVeriffApplicants(req.user!.companyId);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "purge_veriff_applicants",
        metadata: result,
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

applicantsRouter.get("/:id", async (req, res, next) => {
  try {
    const applicant = await getApplicantById(req.user!.companyId, req.params.id);
    if (!applicant) {
      throw new HttpError(404, "NOT_FOUND", "Motorista não encontrado");
    }
    return res.json({ success: true, data: applicant });
  } catch (error) {
    return next(error);
  }
});

applicantsRouter.delete("/:id", requireRole("admin", "operator"), async (req, res, next) => {
  try {
    const applicantId = req.params.id;
    if (!applicantId) {
      throw new HttpError(400, "MISSING_ID", "ID do motorista ausente na URL");
    }
    await deleteApplicant(req.user!.companyId, applicantId);

    await logAudit({
      companyId: req.user!.companyId,
      operatorId: req.user!.operatorId,
      action: "delete_applicant",
      metadata: { applicantId },
    });

    return res.json({ success: true, data: { id: applicantId } });
  } catch (error) {
    return next(error);
  }
});

/**
 * Marca cookies como baixados / não baixados (um ou vários).
 * Body: { applicantIds: string[], downloaded: boolean }
 */
applicantsRouter.patch(
  "/cookies-downloaded",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          applicantIds: z.array(z.string().uuid()).min(1),
          downloaded: z.boolean(),
        })
        .parse(req.body);
      const result = await setCookiesDownloaded(
        req.user!.companyId,
        body.applicantIds,
        body.downloaded,
      );
      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: body.downloaded ? "cookies_marked_downloaded" : "cookies_marked_not_downloaded",
        metadata: { applicantIds: body.applicantIds, updated: result.updated },
      });
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * Download cookies Uber para AdsPower.
 * - default / ?format=json → JSON array compacto (colar no campo Cookie)
 * - ?format=netscape → Netscape cookie file (alternativa)
 * Cada arquivo é da sessão daquele motorista (perfil isolado).
 */
applicantsRouter.get(
  "/:id/uber-cookies",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const applicantId = req.params.id;
      if (!applicantId) {
        throw new HttpError(400, "MISSING_ID", "ID do motorista ausente na URL");
      }
      const format = String(req.query.format ?? "json").toLowerCase();
      const exported = await getUberCookiesExport(req.user!.companyId, applicantId);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        applicantId,
        action: "download_uber_cookies",
        metadata: { cookieCount: exported.cookieCount, format },
      });

      await setCookiesDownloaded(req.user!.companyId, [applicantId], true);

      const safeName = exported.externalId.replace(/[^a-zA-Z0-9._-]/g, "_");

      if (format === "netscape" || format === "txt") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="adspower-cookies-${safeName}.txt"`,
        );
        return res.status(200).send(exported.netscapeCookies);
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="adspower-cookies-${safeName}.json"`,
      );
      // Compacto (1 linha): colar no campo Cookie do AdsPower sem quebrar.
      return res.status(200).send(JSON.stringify(exported.adsPowerCookies));
    } catch (error) {
      return next(error);
    }
  },
);

const startAutomationSchema = z.object({
  proxyId: z.string().uuid(),
  platformPassword: z.string().min(1, "Informe a senha de login da plataforma"),
});

applicantsRouter.post(
  "/:id/start-automation",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      if (!req.params.id) {
        throw new HttpError(400, "MISSING_ID", "ID do motorista ausente na URL");
      }
      const input = startAutomationSchema.parse(req.body);
      const result = await startAutomation(req.user!.companyId, req.params.id, input);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        applicantId: req.params.id,
        action: "automation_start_requested",
        metadata: { jobId: result.jobId, proxyId: input.proxyId },
      });

      return res.status(202).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * Para a automação de um motorista (remove da fila + fecha Chromium ativo).
 */
applicantsRouter.post(
  "/:id/stop-automation",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const applicantId = req.params.id;
      if (!applicantId) {
        throw new HttpError(400, "MISSING_ID", "ID do motorista ausente na URL");
      }
      const result = await stopAutomation(req.user!.companyId, applicantId);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        applicantId,
        action: "automation_stop_requested",
        metadata: result,
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

const openManualBrowserSchema = z.object({
  proxyId: z.string().uuid().optional(),
});

/**
 * Abre Chromium headed no worker (com proxy + cookies salvos) para o
 * operador continuar o fluxo manualmente (ex: SMS).
 */
applicantsRouter.post(
  "/:id/open-manual-browser",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const applicantId = req.params.id;
      if (!applicantId) {
        throw new HttpError(400, "MISSING_ID", "ID do motorista ausente na URL");
      }
      const input = openManualBrowserSchema.parse(req.body ?? {});
      const result = await openManualBrowser(req.user!.companyId, applicantId, input);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        applicantId,
        action: "manual_browser_requested",
        metadata: { jobId: result.jobId, proxyId: result.proxyId },
      });

      return res.status(202).json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * Fecha o Chromium manual (sinal Redis) e limpa jobs/marcadores.
 */
applicantsRouter.post(
  "/:id/close-manual-browser",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      const applicantId = req.params.id;
      if (!applicantId) {
        throw new HttpError(400, "MISSING_ID", "ID do motorista ausente na URL");
      }
      const result = await closeManualBrowser(req.user!.companyId, applicantId);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        applicantId,
        action: "manual_browser_close_requested",
        metadata: result,
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);
