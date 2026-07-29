import { Router } from "express";
import { loginSchema } from "@uber-automation/shared";
import { verifyRefreshToken } from "@uber-automation/security";
import { loginRateLimiter } from "../middleware/rateLimit";
import { authenticate } from "../middleware/auth";
import { HttpError } from "../middleware/errorHandler";
import { loginOperator, refreshOperatorToken } from "../services/auth.service";
import { logAudit } from "../services/auditLog.service";

export const authRouter = Router();

const REFRESH_COOKIE = "refresh_token";
const isProduction = process.env.NODE_ENV === "production";

authRouter.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await loginOperator(email, password);

    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth",
    });

    await logAudit({
      companyId: result.operator.companyId,
      operatorId: result.operator.id,
      action: "login",
      metadata: { email: result.operator.email },
    });

    return res.json({
      success: true,
      data: { accessToken: result.accessToken, operator: result.operator },
    });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new HttpError(401, "MISSING_REFRESH_TOKEN", "Refresh token não encontrado");
    }

    const claims = verifyRefreshToken(token);
    const result = await refreshOperatorToken(claims.sub, claims.companyId);

    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth",
    });

    return res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        operator: {
          id: result.operator.id,
          name: result.operator.name,
          email: result.operator.email,
          role: result.operator.role,
          companyId: result.operator.companyId,
        },
      },
    });
  } catch {
    return res.status(401).json({
      success: false,
      error: { code: "INVALID_REFRESH_TOKEN", message: "Sessão inválida, faça login novamente" },
    });
  }
});

authRouter.post("/logout", authenticate, async (req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  if (req.user) {
    await logAudit({
      companyId: req.user.companyId,
      operatorId: req.user.operatorId,
      action: "logout",
    });
  }
  return res.json({ success: true, data: { loggedOut: true } });
});
