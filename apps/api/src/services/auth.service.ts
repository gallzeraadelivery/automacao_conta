import { eq } from "drizzle-orm";
import { db, operators } from "@uber-automation/database";
import { verifyPassword, signAccessToken, signRefreshToken } from "@uber-automation/security";
import { HttpError } from "../middleware/errorHandler";

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  operator: {
    id: string;
    name: string;
    email: string;
    role: string;
    companyId: string;
  };
}

export async function loginOperator(email: string, password: string): Promise<LoginResult> {
  const [operator] = await db
    .select()
    .from(operators)
    .where(eq(operators.email, email.toLowerCase()))
    .limit(1);

  if (!operator) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email ou senha inválidos");
  }

  const isValid = await verifyPassword(password, operator.passwordHash);
  if (!isValid) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email ou senha inválidos");
  }

  const accessToken = signAccessToken({
    sub: operator.id,
    companyId: operator.companyId,
    role: operator.role,
  });
  const refreshToken = signRefreshToken({ sub: operator.id, companyId: operator.companyId });

  return {
    accessToken,
    refreshToken,
    operator: {
      id: operator.id,
      name: operator.name,
      email: operator.email,
      role: operator.role,
      companyId: operator.companyId,
    },
  };
}

export async function refreshOperatorToken(operatorId: string, companyId: string) {
  const [operator] = await db.select().from(operators).where(eq(operators.id, operatorId)).limit(1);

  if (!operator || operator.companyId !== companyId) {
    throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Sessão inválida, faça login novamente");
  }

  const accessToken = signAccessToken({
    sub: operator.id,
    companyId: operator.companyId,
    role: operator.role,
  });
  const refreshToken = signRefreshToken({ sub: operator.id, companyId: operator.companyId });

  return { accessToken, refreshToken, operator };
}
