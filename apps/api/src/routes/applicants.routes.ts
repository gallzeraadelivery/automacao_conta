import { Router } from "express";
import { z } from "zod";
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
  deleteApplicant,
  getUberCookiesExport,
  openManualBrowser,
  closeManualBrowser,
} from "../services/applicants.service";
import { validateEmailListImport, importEmailList } from "../services/emailListImport.service";
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

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
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
 * Download dos cookies Uber persistidos (JSON Playwright) - para reabrir
 * a sessão no browser após a conta criada.
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
      const exported = await getUberCookiesExport(req.user!.companyId, applicantId);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        applicantId,
        action: "download_uber_cookies",
        metadata: { cookieCount: exported.cookieCount },
      });

      const safeName = exported.externalId.replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="uber-cookies-${safeName}.json"`,
      );
      return res.status(200).send(JSON.stringify(exported, null, 2));
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
