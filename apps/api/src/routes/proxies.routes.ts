import { Router } from "express";
import { createProxySchema } from "@uber-automation/shared";
import { authenticate, requireRole } from "../middleware/auth";
import { HttpError } from "../middleware/errorHandler";
import { createProxy, listProxies, testProxy, deleteProxy } from "../services/proxies.service";
import { logAudit } from "../services/auditLog.service";

export const proxiesRouter = Router();

proxiesRouter.use(authenticate);

proxiesRouter.post("/", requireRole("admin", "operator"), async (req, res, next) => {
  try {
    const input = createProxySchema.parse(req.body);
    const proxy = await createProxy(req.user!.companyId, input);

    await logAudit({
      companyId: req.user!.companyId,
      operatorId: req.user!.operatorId,
      action: "create_proxy",
      metadata: { proxyId: proxy.id, protocol: proxy.protocol },
    });

    return res.status(201).json({ success: true, data: proxy });
  } catch (error) {
    return next(error);
  }
});

proxiesRouter.get("/", async (req, res, next) => {
  try {
    const proxies = await listProxies(req.user!.companyId);
    return res.json({ success: true, data: proxies });
  } catch (error) {
    return next(error);
  }
});

proxiesRouter.post("/:id/test", requireRole("admin", "operator"), async (req, res, next) => {
  try {
    const proxyId = req.params.id;
    if (!proxyId) {
      throw new HttpError(400, "MISSING_ID", "Parâmetro id é obrigatório");
    }
    const proxy = await testProxy(req.user!.companyId, proxyId);

    await logAudit({
      companyId: req.user!.companyId,
      operatorId: req.user!.operatorId,
      action: "test_proxy",
      metadata: { proxyId: proxy.id, status: proxy.status, latencyMs: proxy.latencyMs },
    });

    return res.json({ success: true, data: proxy });
  } catch (error) {
    return next(error);
  }
});

proxiesRouter.delete("/:id", requireRole("admin", "operator"), async (req, res, next) => {
  try {
    const proxyId = req.params.id;
    if (!proxyId) {
      throw new HttpError(400, "MISSING_ID", "Parâmetro id é obrigatório");
    }
    await deleteProxy(req.user!.companyId, proxyId);

    await logAudit({
      companyId: req.user!.companyId,
      operatorId: req.user!.operatorId,
      action: "delete_proxy",
      metadata: { proxyId },
    });

    return res.json({ success: true, data: { id: proxyId } });
  } catch (error) {
    return next(error);
  }
});
