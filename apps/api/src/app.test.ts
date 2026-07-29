import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import request from "supertest";
import type { Express } from "express";

let app: Express;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/uber_automation_test";
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret-not-for-production";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-not-for-production";
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");

  const { createApp } = await import("./app");
  app = createApp();
});

describe("app", () => {
  it("responds to the health check", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });

  it("rejects protected routes without a token", async () => {
    const response = await request(app).get("/api/applicants");
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects login with an invalid payload before touching the database", async () => {
    const response = await request(app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed bearer token", async () => {
    const response = await request(app)
      .get("/api/applicants")
      .set("Authorization", "Bearer not-a-real-token");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
  });
});
