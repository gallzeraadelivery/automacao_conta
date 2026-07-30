import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";

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

function authHeader() {
  const token = signAccessToken({ sub: randomUUID(), companyId: randomUUID(), role: "admin" });
  return `Bearer ${token}`;
}

describe("GET /api/reports/automation", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/reports/automation");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a malformed date range before touching the database", async () => {
    const response = await request(app)
      .get("/api/reports/automation?from=not-a-date")
      .set("Authorization", authHeader());
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/reports/audit", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/reports/audit");
    expect(response.status).toBe(401);
  });
});

describe("GET /api/reports/automation/export", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/reports/automation/export?format=csv");
    expect(response.status).toBe(401);
  });

  it("rejects an unsupported export format before touching the database", async () => {
    const response = await request(app)
      .get("/api/reports/automation/export?format=xml")
      .set("Authorization", authHeader());
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/reports/audit/export", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/reports/audit/export?format=csv");
    expect(response.status).toBe(401);
  });
});
