import { z } from "zod";
import type { ImportRowError, ImportValidationResult } from "./importResult";

const emailPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("email inválido"),
  password: z.string().min(1, "senha é obrigatória"),
});

export interface EmailListRow {
  /** Local-part do e-mail (antes do @) - garantidamente único, usado como external_id do motorista. */
  externalId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Extrai nome/sobrenome do local-part do e-mail (ex: "TrixCordova6o365" ->
 * "Trix"/"Cordova") assumindo que o prefixo usa CamelCase para separar
 * nome/sobrenome, seguido de um sufixo aleatório (letras/dígitos) colado
 * sem separador.
 *
 * Limitação conhecida (best-effort, não há como evitar sem um separador
 * explícito no e-mail): quando o sufixo aleatório é só letras minúsculas
 * (ex: "...Cloughyyvuo", sem nenhum dígito), ele acaba grudado no
 * sobrenome, já que não há como distinguir onde o sobrenome real termina.
 * Revise o preview antes de importar.
 */
export function extractNameFromLocalPart(localPart: string): {
  firstName: string;
  lastName: string;
} {
  const match = localPart.match(/^([A-Z][a-z]+)([A-Z][a-z]+)/);
  if (match) {
    return { firstName: match[1]!, lastName: match[2]! };
  }
  const fallback = localPart.match(/^[A-Za-z]+/);
  return { firstName: fallback ? fallback[0] : localPart, lastName: "" };
}

function parseLine(line: string): { email?: string; password?: string } {
  const [emailRaw, passwordRaw] = line.split("|");
  return { email: emailRaw?.trim(), password: passwordRaw?.trim() };
}

/**
 * Valida uma lista colada no formato "email|senha" (uma por linha) - ex:
 * "TrixCordova6o365@colsced.us|Phat3479". Diferente dos outros imports
 * (CSV/XLSX com colunas fixas), aqui o motorista e a conta de e-mail são
 * criados JUNTOS a partir da mesma linha - não há planilha de motoristas
 * separada. Duplicidade contra o banco é checada depois, pela API (depende
 * do banco) - aqui só schema + duplicidade dentro do próprio texto colado.
 */
export function validateEmailListRows(text: string): ImportValidationResult<EmailListRow> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const validRows: ImportValidationResult<EmailListRow>["validRows"] = [];
  const invalidRows: ImportValidationResult<EmailListRow>["invalidRows"] = [];
  const seenEmails = new Map<string, number>();

  lines.forEach((line, index) => {
    const row = index + 1;
    const { email, password } = parseLine(line);

    if (!email || !password) {
      invalidRows.push({
        row,
        data: { line },
        errors: [{ row, message: 'Formato esperado: "email|senha" (uma linha por motorista)' }],
      });
      return;
    }

    const parsed = emailPasswordSchema.safeParse({ email, password });
    if (!parsed.success) {
      invalidRows.push({
        row,
        data: { email, password: "[REDACTED]" },
        errors: parsed.error.issues.map(
          (issue): ImportRowError => ({
            row,
            field: issue.path.join("."),
            message: issue.message,
          }),
        ),
      });
      return;
    }

    const normalizedEmail = parsed.data.email;
    // O nome e extraido do local-part ORIGINAL (antes do zod normalizar
    // para minusculas) - o CamelCase ("TrixCordova...") e o unico sinal que
    // separa nome/sobrenome, e some se a caixa for perdida antes daqui.
    const originalLocalPart = email.split("@")[0] ?? email;
    const firstRow = seenEmails.get(normalizedEmail);
    if (firstRow !== undefined) {
      invalidRows.push({
        row,
        data: { email: normalizedEmail, password: "[REDACTED]" },
        errors: [
          {
            row,
            field: "email",
            message: `email duplicado no texto colado (primeira ocorrência na linha ${firstRow})`,
          },
        ],
      });
      return;
    }
    seenEmails.set(normalizedEmail, row);

    const { firstName, lastName } = extractNameFromLocalPart(originalLocalPart);

    validRows.push({
      row,
      data: {
        externalId: normalizedEmail.split("@")[0] ?? normalizedEmail,
        email: normalizedEmail,
        password: parsed.data.password,
        firstName,
        lastName,
      },
    });
  });

  return { validRows, invalidRows };
}
