import { Router } from "express";
import { resolveDelivery } from "../services/pendingActions.service";

/**
 * Rota pública (sem autenticação de operador): quem acessa é o motorista,
 * com o token do link que o operador entregou. O token de 256 bits
 * (ver createDriverDelivery) já é a proteção principal - esta rota nunca
 * expõe mais do que o primeiro nome do motorista e o status do link.
 */
export const deliveriesRouter = Router();

deliveriesRouter.get("/:token", async (req, res, next) => {
  try {
    const view = await resolveDelivery(req.params.token);
    return res.json({ success: true, data: view });
  } catch (error) {
    return next(error);
  }
});
