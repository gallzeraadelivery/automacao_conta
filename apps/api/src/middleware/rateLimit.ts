import rateLimit from "express-rate-limit";
import { env } from "../env";

export const loginRateLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." },
  },
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? "")}`,
});
