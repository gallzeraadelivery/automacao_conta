import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { LocalFileKeyProvider, createMasterKeyProvider } from "./masterKeyProvider";

describe("LocalFileKeyProvider", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reads a valid 32-byte key from the key file", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vault-test-"));
    const keyPath = path.join(dir, ".secrets.key");
    const hex = randomBytes(32).toString("hex");
    writeFileSync(keyPath, `${hex}\n`);

    const provider = new LocalFileKeyProvider(keyPath);
    const key = await provider.getMasterKey();
    expect(key.toString("hex")).toBe(hex);
  });

  it("caches the key after the first read", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vault-test-"));
    const keyPath = path.join(dir, ".secrets.key");
    writeFileSync(keyPath, randomBytes(32).toString("hex"));

    const provider = new LocalFileKeyProvider(keyPath);
    const first = await provider.getMasterKey();
    rmSync(keyPath);
    const second = await provider.getMasterKey();
    expect(second).toBe(first);
  });

  it("rejects a key of the wrong length without leaking it in the error", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vault-test-"));
    const keyPath = path.join(dir, ".secrets.key");
    const badKey = "deadbeef";
    writeFileSync(keyPath, badKey);

    const provider = new LocalFileKeyProvider(keyPath);
    await expect(provider.getMasterKey()).rejects.toThrow(/32-byte/);
    try {
      await new LocalFileKeyProvider(keyPath).getMasterKey();
    } catch (error) {
      expect(String(error)).not.toContain(badKey);
    }
  });

  it("throws a clear, non-leaking error when no key source is available", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vault-test-"));
    const keyPath = path.join(dir, "does-not-exist.key");
    const originalEnv = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;

    const provider = new LocalFileKeyProvider(keyPath);
    await expect(provider.getMasterKey()).rejects.toThrow(/Chave mestra nao encontrada/);

    if (originalEnv) process.env.CREDENTIAL_ENCRYPTION_KEY = originalEnv;
  });
});

describe("createMasterKeyProvider", () => {
  it("throws when SECRETS_PROVIDER=aws but no secret id is configured", () => {
    expect(() => createMasterKeyProvider({ provider: "aws", awsSecretId: undefined })).toThrow(
      /AWS_SECRETS_MANAGER_SECRET_ID/,
    );
  });

  it("defaults to the local provider", () => {
    const provider = createMasterKeyProvider({
      provider: "local",
      localKeyFilePath: "/tmp/whatever.key",
    });
    expect(provider).toBeInstanceOf(LocalFileKeyProvider);
  });
});
