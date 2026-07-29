import { Router } from "express";
import { z } from "zod";
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
