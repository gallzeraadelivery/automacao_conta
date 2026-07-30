import { createHash } from "node:crypto";

/**
 * Divide o nome completo em nome/sobrenome para o formulário "Nome e
 * Sobrenome" (Passo 6 do PDF). Nomes com mais de duas palavras: a última
 * palavra vira sobrenome, o resto vira nome (ex: "João Pedro Silva" ->
 * "João Pedro" / "Silva") - mesma convenção usada por `buildPlaceholderPassword`.
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] ?? "", lastName: "" };
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
 */
export function buildPlaceholderPassword(fullName: string, suffix: string): string {
  const { lastName } = splitFullName(fullName);
  const base = lastName || fullName.trim().split(/\s+/)[0] || "Motorista";
  return `${capitalize(base)}${suffix}`;
}

/**
 * Telefone dos EUA temporário/placeholder - obrigatório para completar o
 * cadastro, mas NUNCA o telefone real do motorista. O atendente corrige
 * para o número real na finalização do cadastro (confirmado pelo usuário).
 * Usa a faixa "555-01XX" reservada pelo North American Numbering Plan para
 * uso fictício (nunca atribuída a uma linha real), com os 2 últimos dígitos
 * derivados do applicantId para reduzir colisão entre motoristas em lote -
 * ainda assim há só 100 valores possíveis (0100-0199) por área "201", então
 * isso é estritamente temporário e deve ser corrigido antes do cadastro
 * virar definitivo.
 */
export function buildPlaceholderPhone(applicantId: string): string {
  const hash = createHash("sha256").update(applicantId).digest();
  const suffix = (hash.readUInt16BE(0) % 100).toString().padStart(2, "0");
  return `(201) 555-01${suffix}`;
}
