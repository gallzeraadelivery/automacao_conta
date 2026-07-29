import { describe, it, expect, beforeAll } from "vitest";

const FORBIDDEN_PROXY_FIELDS = [
  "host",
  "hostEncrypted",
  "username",
  "usernameEncrypted",
  "password",
  "passwordEncrypted",
  "encryptionIv",
  "encryptionAuthTag",
];

const FORBIDDEN_CREDENTIAL_COLUMN_NAMES = [
  "encrypted_password",
  "encryption_iv",
  "encryption_auth_tag",
  "host_encrypted",
  "username_encrypted",
  "password_encrypted",
];

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/uber_automation_test";
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret-not-for-production";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-not-for-production";
  process.env.CREDENTIAL_ENCRYPTION_KEY ??=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
});

describe("proxies API never exposes credentials", () => {
  it("toPublicView() strips host/username/password/encryption fields from the DB row", async () => {
    const { toPublicView } = await import("./services/proxies.service");

    // Simula uma linha crua do banco (como viria de proxy_configs) - inclui
    // deliberadamente todos os campos sensiveis para provar que a funcao os remove.
    const fakeRow = {
      id: "proxy-1",
      companyId: "company-1",
      hostEncrypted: "deadbeef",
      port: 8080,
      protocol: "http",
      usernameEncrypted: "beefdead",
      passwordEncrypted: "cafebabe",
      encryptionIv: "abc123",
      encryptionAuthTag: "def456",
      declaredRegion: "BR",
      status: "ACTIVE",
      latencyMs: 42,
      lastCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const publicView = toPublicView(fakeRow as never);
    const keys = Object.keys(publicView);

    for (const forbidden of FORBIDDEN_PROXY_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(publicView)).not.toContain("deadbeef");
    expect(JSON.stringify(publicView)).not.toContain("cafebabe");
  });
});

describe("email accounts API never selects credential columns", () => {
  it("EMAIL_ACCOUNT_LIST_COLUMNS never selects encrypted_password/iv/auth_tag", async () => {
    const { EMAIL_ACCOUNT_LIST_COLUMNS } = await import("./services/emailAccounts.service");
    const { db, emailAccounts } = await import("@uber-automation/database");

    // .toSQL() apenas monta a query - nao executa nem exige uma conexao real,
    // entao este teste roda sem um Postgres disponivel.
    const { sql } = db.select(EMAIL_ACCOUNT_LIST_COLUMNS).from(emailAccounts).toSQL();

    for (const column of FORBIDDEN_CREDENTIAL_COLUMN_NAMES) {
      expect(sql.toLowerCase()).not.toContain(column);
    }
  });

  it("EMAIL_ACCOUNT_LIST_COLUMNS does not reference the credential columns by key either", async () => {
    const { EMAIL_ACCOUNT_LIST_COLUMNS } = await import("./services/emailAccounts.service");
    const keys = Object.keys(EMAIL_ACCOUNT_LIST_COLUMNS);
    expect(keys).not.toContain("encryptedPassword");
    expect(keys).not.toContain("encryptionIv");
    expect(keys).not.toContain("encryptionAuthTag");
  });
});
