import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { CredentialVault } from "@uber-automation/credential-vault";
import { BrowserProfileManager } from "./browserProfileManager";
import type {
  BrowserProfileRecord,
  BrowserProfileRepository,
  EmailAccountLookup,
  NewBrowserProfileRecord,
  ProxyLookup,
} from "./browserProfile.types";

class InMemoryBrowserProfileRepository implements BrowserProfileRepository {
  rows = new Map<string, BrowserProfileRecord>();
  emailAccounts = new Map<string, EmailAccountLookup>();
  proxies = new Map<string, ProxyLookup>();

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async findActiveByApplicantId(applicantId: string) {
    const candidates = [...this.rows.values()]
      .filter((r) => r.applicantId === applicantId && r.status !== "ARCHIVED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return candidates[0] ?? null;
  }

  async insert(row: NewBrowserProfileRecord) {
    const record: BrowserProfileRecord = {
      ...row,
      id: randomUUID(),
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(record.id, record);
    return record;
  }

  async archive(id: string) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, status: "ARCHIVED" });
  }

  async touchLastUsed(id: string) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastUsedAt: new Date() });
  }

  async getEmailAccountStatus(emailAccountId: string) {
    return (
      this.emailAccounts.get(emailAccountId) ?? {
        exists: true,
        deletedAt: null,
        requiresHumanAction: false,
      }
    );
  }

  async getProxyStatus(proxyId: string) {
    return this.proxies.get(proxyId) ?? { exists: true, status: "ACTIVE" };
  }
}

const FIXED_TEST_KEY = randomBytes(32);

function buildManager(
  repo: InMemoryBrowserProfileRepository,
  storageRoot: string,
  maxAgeDays = 30,
) {
  const vault = new CredentialVault({
    masterKeyProvider: { getMasterKey: async () => FIXED_TEST_KEY },
  });
  return new BrowserProfileManager({
    storageRoot,
    repository: repo,
    vault,
    companyId: "company-1",
    maxAgeDays,
  });
}

describe("BrowserProfileManager", () => {
  let storageRoot: string;
  let repo: InMemoryBrowserProfileRepository;

  beforeEach(() => {
    storageRoot = mkdtempSync(path.join(tmpdir(), "browser-profiles-"));
    repo = new InMemoryBrowserProfileRepository();
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("creates the expected directory/file structure for a new profile", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");

    for (const site of ["uber", "gmail"]) {
      for (const file of ["cookies.json", "localStorage.json", "sessionStorage.json"]) {
        const filePath = path.join(storageRoot, "applicant-applicant-1", site, file);
        expect(existsSync(filePath)).toBe(true);
      }
    }
    expect(profile.applicantId).toBe("applicant-1");
    expect(profile.data.uber.cookies).toEqual([]);
  });

  it("never mixes files between two different applicants (isolation)", async () => {
    const manager = buildManager(repo, storageRoot);
    const profileA = await manager.createProfile("applicant-A", "email-A", "proxy-A");
    const profileB = await manager.createProfile("applicant-B", "email-B", "proxy-B");

    expect(profileA.storagePath).not.toBe(profileB.storagePath);

    const cookiesPathA = path.join(profileA.storagePath, "uber", "cookies.json");
    const cookiesPathB = path.join(profileB.storagePath, "uber", "cookies.json");

    // simulate writing session data for A only
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      cookiesPathA,
      JSON.stringify([{ name: "session", value: "for-applicant-A" }]),
    );

    const contentB = JSON.parse(readFileSync(cookiesPathB, "utf8"));
    expect(contentB).toEqual([]);

    const reloadedA = await manager.loadProfile(profileA.id);
    const reloadedB = await manager.loadProfile(profileB.id);
    expect(reloadedA.data.uber.cookies).toEqual([{ name: "session", value: "for-applicant-A" }]);
    expect(reloadedB.data.uber.cookies).toEqual([]);
  });

  it("reuses the same profile when creating again with the same applicant/email/proxy", async () => {
    const manager = buildManager(repo, storageRoot);
    const first = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    const second = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    expect(second.id).toBe(first.id);
    expect(repo.rows.size).toBe(1);
  });

  it("archives the old profile and starts fresh when the email/proxy changes for the same applicant", async () => {
    const manager = buildManager(repo, storageRoot);
    const first = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    const second = await manager.createProfile("applicant-1", "email-2", "proxy-1");

    expect(second.id).not.toBe(first.id);
    expect((await repo.findById(first.id))!.status).toBe("ARCHIVED");
    const active = await repo.findActiveByApplicantId("applicant-1");
    expect(active!.id).toBe(second.id);
  });

  it("validateProfile passes for a freshly created, healthy profile", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    const result = await manager.validateProfileDetailed(profile.id);
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("validateProfile fails when the associated email account requires human action", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    repo.emailAccounts.set("email-1", { exists: true, deletedAt: null, requiresHumanAction: true });

    const result = await manager.validateProfileDetailed(profile.id);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("email_account_requires_human_action");
  });

  it("validateProfile fails when the associated proxy is unhealthy", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    repo.proxies.set("proxy-1", { exists: true, status: "ERROR" });

    const result = await manager.validateProfileDetailed(profile.id);
    expect(result.reasons).toContain("proxy_unhealthy");
  });

  it("validateProfile fails when the session is stale", async () => {
    const manager = buildManager(repo, storageRoot, 0);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    // maxAgeDays=0 means anything older than "now" is stale; wait a tick
    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = await manager.validateProfileDetailed(profile.id);
    expect(result.reasons).toContain("session_stale");
  });

  it("validateProfile fails when session files are missing (integrity)", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");
    rmSync(path.join(profile.storagePath, "gmail", "cookies.json"));

    const result = await manager.validateProfileDetailed(profile.id);
    expect(result.reasons).toContain("session_integrity_failed");
  });

  it("lockProfile prevents reuse until cleared", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");

    await manager.lockProfile(profile.id, "gmail_2fa_detected");
    const locked = await manager.validateProfileDetailed(profile.id);
    expect(locked.valid).toBe(false);
    expect(locked.reasons).toContain("security_lock_active");
  });

  it("clearProfile wipes files and archives the DB row", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");

    await manager.clearProfile(profile.id);

    expect(existsSync(profile.storagePath)).toBe(false);
    expect((await repo.findById(profile.id))!.status).toBe("ARCHIVED");
  });

  it("never stores the plaintext storage path in the DB record", async () => {
    const manager = buildManager(repo, storageRoot);
    const profile = await manager.createProfile("applicant-1", "email-1", "proxy-1");

    const record = await repo.findById(profile.id);
    expect(record!.encryptedStoragePath).not.toContain(storageRoot);
    expect(record!.encryptedStoragePath).not.toContain("applicant-1");
  });
});
