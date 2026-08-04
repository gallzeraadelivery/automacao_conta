import { and, eq } from "drizzle-orm";
import { db, emailAccounts } from "@uber-automation/database";
import type {
  EmailAccountCredentialRecord,
  EmailAccountRepository,
} from "./emailAccountRepository";

function toRecord(row: typeof emailAccounts.$inferSelect): EmailAccountCredentialRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    applicantId: row.applicantId,
    emailAddress: row.emailAddress,
    encryptedPassword: row.encryptedPassword,
    encryptionIv: row.encryptionIv,
    encryptionAuthTag: row.encryptionAuthTag,
    provider: row.provider,
  };
}

export class DrizzleEmailAccountRepository implements EmailAccountRepository {
  async getById(emailAccountId: string): Promise<EmailAccountCredentialRecord | null> {
    const [row] = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, emailAccountId))
      .limit(1);

    return row ? toRecord(row) : null;
  }

  async getByCompanyAndEmail(
    companyId: string,
    emailAddress: string,
  ): Promise<EmailAccountCredentialRecord | null> {
    const [row] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.companyId, companyId),
          eq(emailAccounts.emailAddress, emailAddress.trim().toLowerCase()),
        ),
      )
      .limit(1);

    return row ? toRecord(row) : null;
  }

  async markRequiresHumanAction(emailAccountId: string, reason: string): Promise<void> {
    await db
      .update(emailAccounts)
      .set({ requiresHumanAction: true, loginStatus: reason, updatedAt: new Date() })
      .where(eq(emailAccounts.id, emailAccountId));
  }

  async recordLoginResult(emailAccountId: string, status: string): Promise<void> {
    await db
      .update(emailAccounts)
      .set({ loginStatus: status, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(emailAccounts.id, emailAccountId));
  }
}
