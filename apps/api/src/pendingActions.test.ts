import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";

/**
 * Mesma restrição das outras suítes desta API (ver `security.test.ts`):
 * nenhum teste aqui toca um Postgres real. Cobre o que dá para verificar
 * sem banco - autenticação obrigatória, e validação de entrada acontecendo
 * ANTES de qualquer chamada ao banco (zod `.parse()` roda primeiro em toda
 * rota nova desta fase). A camada de isolamento por empresa em si
 * (`eq(applicants.companyId, companyId)` em toda query) é garantida pela
 * mesma revisão de código que já cobre `applicants.service.ts`/
 * `emailAccounts.service.ts` - não há teste de integração multi-empresa
 * com banco real nesta suíte, assim como não há para os serviços existentes.
 */
let app: Express;
let signAccessToken: (claims: { sub: string; companyId: string; role: string }) => string;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/uber_automation_test";
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret-not-for-production";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-not-for-production";
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");

  const { createApp } = await import("./app");
  app = createApp();
  ({ signAccessToken } = await import("@uber-automation/security"));
});

function authHeader(role: "admin" | "operator" | "viewer" = "operator") {
  const token = signAccessToken({ sub: randomUUID(), companyId: randomUUID(), role });
  return `Bearer ${token}`;
}

describe("GET /api/pending-actions", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/pending-actions");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an invalid assignedTo filter before touching the database", async () => {
    const response = await request(app)
      .get("/api/pending-actions?assignedTo=not-a-uuid")
      .set("Authorization", authHeader());
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/pending-actions/:id", () => {
  it("requires authentication", async () => {
    const response = await request(app).get(`/api/pending-actions/${randomUUID()}`);
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/pending-actions/:id", () => {
  it("requires authentication", async () => {
    const response = await request(app)
      .patch(`/api/pending-actions/${randomUUID()}`)
      .send({ action: "RESOLVED" });
    expect(response.status).toBe(401);
  });

  it("rejects viewers (read-only role)", async () => {
    const response = await request(app)
      .patch(`/api/pending-actions/${randomUUID()}`)
      .set("Authorization", authHeader("viewer"))
      .send({ action: "RESOLVED" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects an invalid action value before touching the database", async () => {
    const response = await request(app)
      .patch(`/api/pending-actions/${randomUUID()}`)
      .set("Authorization", authHeader("operator"))
      .send({ action: "DELETE_EVERYTHING" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/pending-actions/:id/deliver", () => {
  it("requires authentication", async () => {
    const response = await request(app).post(`/api/pending-actions/${randomUUID()}/deliver`);
    expect(response.status).toBe(401);
  });

  it("rejects an expiresIn below the minimum (60s) before touching the database", async () => {
    const response = await request(app)
      .post(`/api/pending-actions/${randomUUID()}/deliver`)
      .set("Authorization", authHeader("operator"))
      .send({ expiresIn: 10 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// GET /api/deliveries/:token é intencionalmente pública (quem acessa é o
// motorista, não um operador - ver deliveries.routes.ts, que nunca usa
// `authenticate`). Não há teste automatizado para isso aqui: exercitar a
// rota de verdade exige uma consulta ao banco (resolveDelivery), e sem um
// Postgres disponível neste ambiente de teste a falha de conexão gera ruído
// (stack trace) no output mesmo capturada corretamente pelo error handler -
// verificado por revisão de código em vez de teste automatizado.
