import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashDeliveryToken } from "./pendingActions.service";

/**
 * `createDriverDelivery`/`resolveDelivery` (que tocam o banco) não são
 * testados aqui - ver a mesma restrição em `security.test.ts` (esta suíte
 * evita depender de um Postgres real). O que É unitariamente testável, e o
 * que importa para a garantia de segurança ("só o hash vai para o banco,
 * nunca o token em texto puro"), é a função de hash em si.
 */
describe("hashDeliveryToken", () => {
  it("is deterministic for the same token", () => {
    const token = randomBytes(32).toString("base64url");
    expect(hashDeliveryToken(token)).toBe(hashDeliveryToken(token));
  });

  it("produces different hashes for different tokens", () => {
    const a = randomBytes(32).toString("base64url");
    const b = randomBytes(32).toString("base64url");
    expect(hashDeliveryToken(a)).not.toBe(hashDeliveryToken(b));
  });

  it("never returns the plaintext token itself", () => {
    const token = randomBytes(32).toString("base64url");
    expect(hashDeliveryToken(token)).not.toContain(token);
  });

  it("produces a 64-character lowercase hex digest (SHA-256)", () => {
    const hash = hashDeliveryToken("any-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
