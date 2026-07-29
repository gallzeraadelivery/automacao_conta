import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db, browserProfiles, emailAccounts, proxyConfigs } from "@uber-automation/database";
import type {
  BrowserProfileRecord,
  BrowserProfileRepository,
  EmailAccountLookup,
  NewBrowserProfileRecord,
  ProxyLookup,
} from "./browserProfile.types";

function toRecord(row: typeof browserProfiles.$inferSelect): BrowserProfileRecord {
  return {
    id: row.id,
    applicantId: row.applicantId,
    emailAccountId: row.emailAccountId,
    proxyId: row.proxyId,
    encryptedStoragePath: row.encryptedStoragePath,
    status: row.status,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleBrowserProfileRepository implements BrowserProfileRepository {
  async findById(id: string): Promise<BrowserProfileRecord | null> {
    const [row] = await db
      .select()
      .from(browserProfiles)
      .where(eq(browserProfiles.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findActiveByApplicantId(applicantId: string): Promise<BrowserProfileRecord | null> {
    const [row] = await db
      .select()
      .from(browserProfiles)
      .where(
        and(eq(browserProfiles.applicantId, applicantId), ne(browserProfiles.status, "ARCHIVED")),
      )
      .orderBy(desc(browserProfiles.createdAt))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async insert(row: NewBrowserProfileRecord): Promise<BrowserProfileRecord> {
    const [inserted] = await db
      .insert(browserProfiles)
      .values({
        applicantId: row.applicantId,
        emailAccountId: row.emailAccountId,
        proxyId: row.proxyId,
        encryptedStoragePath: row.encryptedStoragePath,
        status: row.status,
      })
      .returning();
    return toRecord(inserted!);
  }

  async archive(id: string): Promise<void> {
    await db
      .update(browserProfiles)
      .set({ status: "ARCHIVED", updatedAt: new Date() })
      .where(eq(browserProfiles.id, id));
  }

  async touchLastUsed(id: string): Promise<void> {
    await db
      .update(browserProfiles)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(browserProfiles.id, id));
  }

  async getEmailAccountStatus(emailAccountId: string): Promise<EmailAccountLookup | null> {
    const [row] = await db
      .select({
        deletedAt: emailAccounts.deletedAt,
        requiresHumanAction: emailAccounts.requiresHumanAction,
      })
      .from(emailAccounts)
      .where(and(eq(emailAccounts.id, emailAccountId), isNull(emailAccounts.deletedAt)))
      .limit(1);

    if (!row) {
      return { exists: false, deletedAt: null, requiresHumanAction: false };
    }
    return { exists: true, deletedAt: row.deletedAt, requiresHumanAction: row.requiresHumanAction };
  }

  async getProxyStatus(proxyId: string): Promise<ProxyLookup | null> {
    const [row] = await db
      .select({ status: proxyConfigs.status })
      .from(proxyConfigs)
      .where(eq(proxyConfigs.id, proxyId))
      .limit(1);

    if (!row) return { exists: false, status: "UNKNOWN" };
    return { exists: true, status: row.status };
  }
}
