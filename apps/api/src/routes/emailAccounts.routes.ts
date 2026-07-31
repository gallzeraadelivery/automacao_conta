import { Router } from "express";
import { z } from "zod";
import { testImapConnectivity } from "@uber-automation/email-service";
import { maskEmail } from "@uber-automation/security";
import { authenticate, requireRole } from "../middleware/auth";
import { uploadSpreadsheet } from "../middleware/upload";
import { HttpError } from "../middleware/errorHandler";
import { parseSpreadsheetBuffer } from "../lib/parseSpreadsheet";
import {
  validateEmailAccountImport,
  importEmailAccounts,
  listEmailAccounts,
} from "../services/emailAccounts.service";
import { logAudit } from "../services/auditLog.service";

export const emailAccountsRouter = Router();

emailAccountsRouter.use(authenticate);

emailAccountsRouter.post(
  "/validate-import",
  requireRole("admin", "operator"),
  uploadSpreadsheet.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, "MISSING_FILE", "Envie um arquivo no campo 'file'");
      }
      const rows = parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
      const result = await validateEmailAccountImport(req.user!.companyId, rows);
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

emailAccountsRouter.post(
  "/import",
  requireRole("admin", "operator"),
  uploadSpreadsheet.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(400, "MISSING_FILE", "Envie um arquivo no campo 'file'");
      }
      const rows = parseSpreadsheetBuffer(req.file.buffer, req.file.originalname);
      const result = await importEmailAccounts(req.user!.companyId, rows);

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        action: "import_email_accounts",
        metadata: { imported: result.imported, skipped: result.skipped },
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  },
);

const testImapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Testa se um e-mail aceita IMAP com a senha direta ANTES de importar um
 * lote inteiro - descoberto na prática que contas de um mesmo fornecedor
 * podem ter políticas diferentes (2FA/"less secure apps" bloqueando IMAP em
 * algumas, liberado em outras). Não persiste nada - só conecta e testa.
 */
emailAccountsRouter.post("/test-imap", requireRole("admin", "operator"), async (req, res, next) => {
  try {
    const { email, password } = testImapSchema.parse(req.body);
    const result = await testImapConnectivity(email, password);

    await logAudit({
      companyId: req.user!.companyId,
      operatorId: req.user!.operatorId,
      action: "test_imap_access",
      metadata: { email: maskEmail(email), success: result.success, error: result.error },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

emailAccountsRouter.get("/", async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await listEmailAccounts(req.user!.companyId, query);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});
