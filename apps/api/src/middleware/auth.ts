import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "@uber-automation/security";
import type { AuthenticatedUser } from "@uber-automation/shared";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Missing or invalid Authorization header" },
    });
  }

  const token = header.slice("Bearer ".length);

  try {
    const claims = verifyAccessToken(token);
    req.user = {
      operatorId: claims.sub,
      companyId: claims.companyId,
      role: claims.role as AuthenticatedUser["role"],
    };
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Invalid or expired access token" },
    });
  }
}

export function requireRole(...roles: AuthenticatedUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHENTICATED", message: "Missing authentication" },
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      });
    }
    return next();
  };
}
