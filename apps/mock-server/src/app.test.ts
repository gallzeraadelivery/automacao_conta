import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

let app: Express;

beforeAll(async () => {
  process.env.MOCK_SESSION_SECRET ??= "test-secret";
  const { createApp } = await import("./app");
  app = createApp();
});

describe("mock-server basic routes", () => {
  it("responds to the health check", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
  });

  it("serves the login page with the expected data-testid hooks", async () => {
    const response = await request(app).get("/mock-uber/login");
    expect(response.status).toBe(200);
    expect(response.text).toContain('data-testid="login-form"');
    expect(response.text).toContain('data-testid="login-email"');
    expect(response.text).toContain('data-testid="login-password"');
  });

  it("redirects unauthenticated visitors away from the application page", async () => {
    const response = await request(app).get("/mock-uber/application");
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/mock-uber/login");
  });
});

describe("mock-server full flow (login -> application -> email code -> scenario page)", () => {
  it("walks the whole flow and lands on the default scenario page", async () => {
    const agent = request.agent(app);

    const loginRes = await agent
      .post("/mock-uber/login")
      .type("form")
      .send({ email: "driver@example.com", password: "anything" });
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toContain("/mock-uber/application");

    const appPage = await agent.get("/mock-uber/application");
    expect(appPage.status).toBe(200);
    expect(appPage.text).not.toContain('data-testid="application-error"');

    const appSubmit = await agent.post("/mock-uber/application").type("form").send({
      fullName: "João da Silva",
      email: "driver@example.com",
      phone: "11999999999",
      address: "Rua Teste, 123",
      city: "São Paulo",
      state: "SP",
      postalCode: "01000-000",
      vehicleType: "sedan",
    });
    expect(appSubmit.status).toBe(302);
    expect(appSubmit.headers.location).toContain("/mock-uber/email-verification");

    const emailPage = await agent.get("/mock-uber/email-verification");
    expect(emailPage.status).toBe(200);
    const match = emailPage.text.match(/data-test-code="(\d{6})"/);
    expect(match).not.toBeNull();
    const code = match![1];

    const wrongCode = await agent
      .post("/mock-uber/email-verification")
      .type("form")
      .send({ code: "000000" });
    expect(wrongCode.status).toBe(400);
    expect(wrongCode.text).toContain('data-testid="email-verification-error"');

    const rightCode = await agent.post("/mock-uber/email-verification").type("form").send({ code });
    expect(rightCode.status).toBe(302);
    expect(rightCode.headers.location).toContain("/mock-uber/next-step");

    const nextStep = await agent.get("/mock-uber/next-step");
    expect(nextStep.status).toBe(302);
    expect(nextStep.headers.location).toBe("/mock-uber/profile-photo-socure");
  });

  it("routes to a different terminal scenario when ?scenario= is set", async () => {
    const agent = request.agent(app);
    await agent.get("/mock-uber/login?scenario=captcha");
    await agent.post("/mock-uber/login").type("form").send({ email: "a@b.com", password: "x" });
    await agent.post("/mock-uber/application").type("form").send({
      fullName: "Maria",
      email: "a@b.com",
      phone: "11988887777",
      address: "Rua X",
      city: "Rio de Janeiro",
      state: "RJ",
      postalCode: "20000-000",
      vehicleType: "suv",
    });
    const emailPage = await agent.get("/mock-uber/email-verification");
    const code = emailPage.text.match(/data-test-code="(\d{6})"/)![1];
    await agent.post("/mock-uber/email-verification").type("form").send({ code });

    const nextStep = await agent.get("/mock-uber/next-step");
    expect(nextStep.headers.location).toBe("/mock-uber/captcha");
  });
});

describe("mock-server terminal scenario pages", () => {
  const pages = [
    ["/mock-uber/profile-photo-socure", "Socure"],
    ["/mock-uber/profile-photo-other", "Verificador XYZ"],
    ["/mock-uber/profile-photo-unknown", "provider-unknown-notice"],
    ["/mock-uber/driver-license-socure", "Socure"],
    ["/mock-uber/driver-license-other", "Verificador XYZ"],
    ["/mock-uber/captcha", "captcha-page"],
    ["/mock-uber/two-factor", "two-factor-page"],
    ["/mock-uber/security-block", "security-block-page"],
  ] as const;

  it.each(pages)("GET %s returns 200 and mentions %s", async (url, needle) => {
    const response = await request(app).get(url);
    expect(response.status).toBe(200);
    expect(response.text).toContain(needle);
  });

  it("never exposes a functional bypass on captcha/2FA/security-block pages", async () => {
    const captcha = await request(app).get("/mock-uber/captcha");
    expect(captcha.text).toMatch(/id="captcha-checkbox"[^>]*disabled/);

    const twoFactor = await request(app).get("/mock-uber/two-factor");
    expect(twoFactor.text).toMatch(/data-testid="two-factor-code"[^>]*disabled/);
    expect(twoFactor.text).toMatch(/data-testid="two-factor-submit"[^>]*disabled/);

    const block = await request(app).get("/mock-uber/security-block");
    expect(block.text).not.toContain("<form");
  });

  it("clearly identifies the Socure provider by name, distinct from the other provider", async () => {
    const socure = await request(app).get("/mock-uber/profile-photo-socure");
    expect(socure.text).toContain('data-provider="socure"');
    expect(socure.text).toContain("Socure");

    const other = await request(app).get("/mock-uber/profile-photo-other");
    expect(other.text).toContain('data-provider="other"');
    expect(other.text).toContain("Verificador XYZ");
    expect(other.text).not.toContain(">Socure<");
  });

  it("never clearly identifies a provider on the unknown page", async () => {
    const unknown = await request(app).get("/mock-uber/profile-photo-unknown");
    expect(unknown.text).toContain('data-provider="unknown"');
    expect(unknown.text).not.toContain("Socure");
    expect(unknown.text).not.toContain("Verificador XYZ");
  });
});
