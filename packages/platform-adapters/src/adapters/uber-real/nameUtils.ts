/**
 * Divide o nome completo em nome/sobrenome para o formulário "Nome e
 * Sobrenome" (Passo 6 do PDF). Nomes com mais de duas palavras: a última
 * palavra vira sobrenome, o resto vira nome (ex: "João Pedro Silva" ->
 * "João Pedro" / "Silva") - mesma convenção usada por `buildPlaceholderPassword`.
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "Driver", lastName: "Partner" };
  }
  if (parts.length === 1) {
    // Uber exige last name ("This field is required"). Com nome extraído
    // só do e-mail (ex: "galldelivery") não há sobrenome - usa placeholder
    // administrativo; o atendente corrige na finalização.
    return { firstName: parts[0]!, lastName: "Driver" };
  }
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1]! };
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Senha padrão do sistema: Sobrenome + sufixo fixo (ex: "Silva@2026") -
 * decisão explícita do operador (não uma senha aleatória seria mais segura
 * contra adivinhação em lote, mas o time optou por este padrão fixo, com o
 * motorista trocando a senha depois).
 *
 * Uber exige ≥ 8 caracteres + 1 dígito + 1 não-dígito. Sobrenomes curtos
 * (ex: "Sa" → "Sa@2026" = 7) são preenchidos com 'x' até atingir 8.
 */
export function buildPlaceholderPassword(fullName: string, suffix: string): string {
  // Senha baseada no sobrenome real do nome completo. Se só houver uma
  // palavra (ex: e-mail → "galldelivery"), usa ela - NÃO o lastName
  // placeholder "Driver" de splitFullName (esse existe só pra Uber exigir
  // last name no formulário).
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  let baseWord = capitalize(parts.length >= 2 ? parts[parts.length - 1]! : parts[0] || "Motorista");
  while (`${baseWord}${suffix}`.length < 8) {
    baseWord += "x";
  }
  return `${baseWord}${suffix}`;
}

/**
 * Telefone dos EUA usado no cadastro (nunca o número real do motorista —
 * o atendente corrige na finalização). Formato padrão NANP, ex.:
 * `(561) 325-6600`. A alocação “próximo livre” (sem repetir os que foram
 * ao hub) fica em `nextFreePlaceholderPhoneDigits` + pool do worker.
 *
 * Base configurável via painel (`company_settings.placeholder_phone_base`)
 * ou env `UBER_PLACEHOLDER_PHONE_BASE` (10 dígitos). Padrão: 5613265300.
 */
export const DEFAULT_PHONE_BASE_DIGITS = "5613265300";

export function normalizePhoneBaseDigits(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length !== 10) return DEFAULT_PHONE_BASE_DIGITS;
  return digits;
}

/**
 * Resolve a base efetiva. `override` (ex.: valor do banco) tem prioridade
 * sobre a env; se ambos inválidos, cai no DEFAULT.
 */
export function resolvePhoneBaseDigits(override?: string | null): string {
  if (override != null && String(override).trim() !== "") {
    return normalizePhoneBaseDigits(override);
  }
  return normalizePhoneBaseDigits(process.env.UBER_PLACEHOLDER_PHONE_BASE);
}

export function toPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function formatUsPhoneFromDigits(digits10: string): string {
  const digits = digits10.replace(/\D/g, "").padStart(10, "0").slice(-10);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

/** Índice 0 = base, 1 = base+1, … */
export function buildPlaceholderPhone(_applicantId: string, attempt = 0, baseOverride?: string): string {
  const baseNum = Number.parseInt(resolvePhoneBaseDigits(baseOverride), 10);
  const next = baseNum + Math.max(0, attempt);
  return formatUsPhoneFromDigits(next.toString().padStart(10, "0").slice(-10));
}

/**
 * Próximo número livre a partir da base, pulando os já usados no hub
 * (e quaisquer outros bloqueados nesta execução).
 */
export function nextFreePlaceholderPhoneDigits(
  blockedDigits: Iterable<string>,
  maxScan = 10_000,
  baseOverride?: string,
): string {
  const blocked = new Set(
    [...blockedDigits].map((d) => d.replace(/\D/g, "").slice(-10)).filter((d) => d.length === 10),
  );
  const baseNum = Number.parseInt(resolvePhoneBaseDigits(baseOverride), 10);
  for (let i = 0; i < maxScan; i++) {
    const digits = (baseNum + i).toString().padStart(10, "0").slice(-10);
    if (!blocked.has(digits)) return digits;
  }
  throw new Error("Esgotou a faixa de telefones placeholder (pool cheio)");
}

