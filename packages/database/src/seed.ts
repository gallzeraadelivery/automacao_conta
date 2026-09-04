import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { eq } from "drizzle-orm";
import { hashPassword } from "@uber-automation/security";
import { db, closeDatabase, companies, operators } from "./index";

// Carrega o .env da raiz do monorepo independentemente do cwd de onde o
// processo foi iniciado (ex: `pnpm --filter` muda o cwd para o pacote).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

/**
 * Cria uma empresa e um operador admin iniciais para desenvolvimento local.
 * Idempotente: nao duplica se ja existirem.
 *
 * Uso: SEED_COMPANY_NAME=... SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm db:seed
 */
async function main() {
  const companyName = process.env.SEED_COMPANY_NAME ?? "Empresa Demo";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const adminName = process.env.SEED_ADMIN_NAME ?? "Administrador";
  const resetPassword =
    process.env.SEED_ADMIN_RESET_PASSWORD === "1" ||
    process.env.SEED_ADMIN_RESET_PASSWORD === "true";

  let [company] = await db.select().from(companies).where(eq(companies.name, companyName)).limit(1);
  if (!company) {
    const inserted = await db.insert(companies).values({ name: companyName }).returning();
    company = inserted[0]!;
    console.log(`Empresa criada: ${company.name} (${company.id})`);
  } else {
    console.log(`Empresa já existia: ${company.name} (${company.id})`);
  }

  const [existingOperator] = await db
    .select()
    .from(operators)
    .where(eq(operators.email, adminEmail))
    .limit(1);

  if (!existingOperator) {
    const passwordHash = await hashPassword(adminPassword);
    const insertedOperators = await db
      .insert(operators)
      .values({
        companyId: company.id,
        name: adminName,
        email: adminEmail,
        passwordHash,
        role: "admin",
      })
      .returning();
    const operator = insertedOperators[0]!;
    console.log(`Operador admin criado: ${operator.email}`);
    console.log(`Senha inicial: ${adminPassword} (troque assim que possível)`);
  } else if (resetPassword) {
    const passwordHash = await hashPassword(adminPassword);
    await db
      .update(operators)
      .set({ passwordHash })
      .where(eq(operators.email, adminEmail));
    console.log(`Senha do admin atualizada: ${existingOperator.email}`);
    console.log(`Nova senha: ${adminPassword}`);
  } else {
    console.log(`Operador já existia: ${existingOperator.email}`);
  }

  await closeDatabase();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
