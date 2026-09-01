import crypto from "node:crypto";
import type { Env } from "../env.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export class AuthService {
  constructor(private readonly env: Env) {}

  verifyCredentials(username: string, password: string): boolean {
    const userOk = timingSafeEqual(username.trim(), this.env.LICENSE_ADMIN_USER);
    const passOk = timingSafeEqual(password, this.env.LICENSE_ADMIN_PASSWORD);
    return userOk && passOk;
  }

  createSessionToken(): string {
    const exp = String(Date.now() + SESSION_TTL_MS);
    const sig = crypto.createHmac("sha256", this.env.LICENSE_SESSION_SECRET).update(exp).digest("base64url");
    return `${exp}.${sig}`;
  }

  verifySessionToken(token: string | undefined): boolean {
    if (!token) return false;
    const dot = token.indexOf(".");
    if (dot <= 0) return false;
    const exp = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expMs = Number(exp);
    if (!Number.isFinite(expMs) || Date.now() > expMs) return false;
    const expected = crypto
      .createHmac("sha256", this.env.LICENSE_SESSION_SECRET)
      .update(exp)
      .digest("base64url");
    return timingSafeEqual(sig, expected);
  }

  sessionMaxAgeMs(): number {
    return SESSION_TTL_MS;
  }
}
