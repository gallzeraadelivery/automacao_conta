import jwt, { type SignOptions } from "jsonwebtoken";

export interface AccessTokenClaims {
  sub: string; // operator id
  companyId: string;
  role: string;
  type: "access";
}

export interface RefreshTokenClaims {
  sub: string; // operator id
  companyId: string;
  type: "refresh";
}

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  return secret;
}

function getRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is not set");
  return secret;
}

export function signAccessToken(claims: Omit<AccessTokenClaims, "type">): string {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? "15m") as SignOptions["expiresIn"],
  };
  return jwt.sign({ ...claims, type: "access" }, getAccessSecret(), options);
}

export function signRefreshToken(claims: Omit<RefreshTokenClaims, "type">): string {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"],
  };
  return jwt.sign({ ...claims, type: "refresh" }, getRefreshSecret(), options);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, getAccessSecret()) as AccessTokenClaims;
  if (decoded.type !== "access") {
    throw new Error("Invalid token type");
  }
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, getRefreshSecret()) as RefreshTokenClaims;
  if (decoded.type !== "refresh") {
    throw new Error("Invalid token type");
  }
  return decoded;
}
