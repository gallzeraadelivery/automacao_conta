import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { HttpError } from "../middleware/errorHandler";
import {
  listPendingActions,
  getPendingActionById,
  updatePendingAction,
  getPendingActionAuditLogs,
  createDriverDelivery,
} from "../services/pendingActions.service";
import { logAudit } from "../services/auditLog.service";
import { env } from "../env";

export const pendingActionsRouter = Router();

pendingActionsRouter.use(authenticate);

const listQuerySchema = z.object({
  assignedTo: z.string().uuid().optional(),
  sortBy: z.enum(["pausedAt", "createdAt"]).default("pausedAt"),
});

// Lista a Central de Pendências (applicants com status AWAITING_HUMAN_ACTION
// desta empresa). O filtro `?status=` do briefing é implícito - esta rota
// só existe para esse status; os demais status ficam em GET /api/applicants.
pendingActionsRouter.get("/", async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const items = await listPendingActions(req.user!.companyId, query);
    return res.json({ success: true, data: { items } });
  } catch (error) {
    return next(error);
  }
});

pendingActionsRouter.get("/:id", async (req, res, next) => {
  try {
    const item = await getPendingActionById(req.user!.companyId, req.params.id);
    if (!item) {
      throw new HttpError(404, "NOT_FOUND", "Pendência não encontrada");
    }
    return res.json({ success: true, data: item });
  } catch (error) {
    return next(error);
  }
});

const patchSchema = z.object({
  action: z.enum(["RESOLVED", "CANCELLED", "MANUAL_REVIEW"]),
});

pendingActionsRouter.patch("/:id", requireRole("admin", "operator"), async (req, res, next) => {
  try {
    if (!req.params.id) {
      throw new HttpError(400, "MISSING_ID", "Parâmetro id é obrigatório");
    }
    const { action } = patchSchema.parse(req.body);
    const updated = await updatePendingAction(
      req.user!.companyId,
      req.params.id,
      req.user!.operatorId,
      action,
    );
    if (!updated) {
      throw new HttpError(404, "NOT_FOUND", "Pendência não encontrada");
    }

    await logAudit({
      companyId: req.user!.companyId,
      operatorId: req.user!.operatorId,
      applicantId: req.params.id,
      action: `pending_action_${action.toLowerCase()}`,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

pendingActionsRouter.get("/:id/audit-logs", async (req, res, next) => {
  try {
    const item = await getPendingActionById(req.user!.companyId, req.params.id);
    if (!item) {
      throw new HttpError(404, "NOT_FOUND", "Pendência não encontrada");
    }
    const items = await getPendingActionAuditLogs(req.user!.companyId, req.params.id);
    return res.json({ success: true, data: { items } });
  } catch (error) {
    return next(error);
  }
});

// Não há pipeline de captura/armazenamento de screenshot ainda (exigiria
// apps/worker chamar page.screenshot() durante a automação e persistir o
// arquivo sanitizado em algum storage - ver README, "Limitações conhecidas").
// A rota existe para já fixar o contrato de API esperado pelo painel.
pendingActionsRouter.get("/:id/screenshot", async (req, res, next) => {
  try {
    const item = await getPendingActionById(req.user!.companyId, req.params.id);
    if (!item) {
      throw new HttpError(404, "NOT_FOUND", "Pendência não encontrada");
    }
    throw new HttpError(
      404,
      "SCREENSHOT_NOT_AVAILABLE",
      "Nenhuma screenshot disponível para esta pendência",
    );
  } catch (error) {
    return next(error);
  }
});

const deliverSchema = z.object({
  expiresIn: z.coerce
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .default(3600),
});

pendingActionsRouter.post(
  "/:id/deliver",
  requireRole("admin", "operator"),
  async (req, res, next) => {
    try {
      if (!req.params.id) {
        throw new HttpError(400, "MISSING_ID", "Parâmetro id é obrigatório");
      }
      const { expiresIn } = deliverSchema.parse(req.body ?? {});
      const item = await getPendingActionById(req.user!.companyId, req.params.id);
      if (!item) {
        throw new HttpError(404, "NOT_FOUND", "Pendência não encontrada");
      }

      const { token, expiresAt } = await createDriverDelivery(
        req.user!.companyId,
        req.params.id,
        req.user!.operatorId,
        expiresIn,
      );

      await logAudit({
        companyId: req.user!.companyId,
        operatorId: req.user!.operatorId,
        applicantId: req.params.id,
        action: "deliver_to_driver",
        metadata: { expiresIn },
      });

      return res.json({
        success: true,
        data: { deliveryLink: `${env.WEB_PUBLIC_URL}/d/${token}`, expiresAt },
      });
    } catch (error) {
      return next(error);
    }
  },
);
