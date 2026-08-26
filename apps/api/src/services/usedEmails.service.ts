import { and, eq, inArray } from "drizzle-orm";
import { db, usedEmails } from "@uber-automation/database";

function normalizeEmails(emails: string[]): string[] {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

/** Grava e-mails usados. Conflito (já reservado) é ignorado. */
export async function recordUsedEmails(
  companyId: string,
  emails: string[],
  source: string,
): Promise<number> {
  const unique = normalizeEmails(emails);
  if (unique.length === 0) return 0;

  let inserted = 0;
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200).map((email) => ({
      companyId,
      email,
      source,
    }));
    const result = await db
      .insert(usedEmails)
      .values(chunk)
      .onConflictDoNothing({
        target: [usedEmails.companyId, usedEmails.email],
      })
      .returning({ email: usedEmails.email });
    inserted += result.length;
  }
  return inserted;
}

export async function findReservedEmails(
  companyId: string,
  emails: string[],
): Promise<Set<string>> {
  const unique = normalizeEmails(emails);
  if (unique.length === 0) return new Set();

  const rows = await db
    .select({ email: usedEmails.email })
    .from(usedEmails)
    .where(and(eq(usedEmails.companyId, companyId), inArray(usedEmails.email, unique)));

  return new Set(rows.map((row) => row.email.toLowerCase()));
}
