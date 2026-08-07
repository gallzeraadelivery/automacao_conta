import type { CodeConfidence, GmailMessage } from "./types";

const SUBJECT_KEYWORDS = [
  "código",
  "codigo",
  "code",
  "confirmation",
  "confirmação",
  "confirmacao",
  "confirm",
  "verify",
  "verification",
  "verificação",
  "verificacao",
  "otp",
];

const FORWARD_PREFIXES = ["fwd:", "fw:", "enc:", "encaminhar:", "encaminhado:"];

/**
 * Codigo perto de uma palavra-chave, ex: "codigo: 482913", "code is 482913",
 * "Seu código de verificação é 482913". A janela de ate 40 caracteres nao-
 * digitos acomoda frases naturais em portugues/ingles entre a palavra-chave
 * e o numero.
 */
const CODE_NEAR_KEYWORD_PATTERN = /(?:c[oó]digo|code|otp|pin)\D{0,40}(\d[\d\s-]{2,9}\d)/i;
/** Fallback generico: 4 a 8 digitos isolados. */
const GENERIC_CODE_PATTERN = /\b(\d{4,8})\b/;

export interface CodeFilterCriteria {
  requestedAt: Date;
  expectedSender?: string;
  /**
   * E-mail do motorista no signup (ex: gallsuper10@mail2too.com). Em
   * caixas catch-all, prioriza mensagens que mencionam esse endereço no
   * corpo/assunto para não pegar OTP de outro alias.
   */
  expectedRecipient?: string;
  usedCodes?: Set<string>;
  /**
   * Confiança mínima aceita. Padrão: MEDIUM — LOW em catch-all costuma ser
   * lixo (ex: ****00) e a Uber rejeita o passcode.
   */
  minConfidence?: CodeConfidence;
}

export interface CodeCandidate {
  code: string;
  confidence: CodeConfidence;
  messageId: string;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function isForwarded(subject: string): boolean {
  const normalized = normalize(subject).trim();
  return FORWARD_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function subjectMatchesKeywords(subject: string): boolean {
  const normalized = normalize(subject);
  return SUBJECT_KEYWORDS.some((keyword) => normalized.includes(normalize(keyword)));
}

function senderMatches(from: string, expectedSender?: string): "exact" | "domain" | "none" {
  if (!expectedSender) return "none";
  const normalizedFrom = from.toLowerCase();
  const normalizedExpected = expectedSender.toLowerCase();

  if (normalizedFrom === normalizedExpected || normalizedFrom.includes(`<${normalizedExpected}>`)) {
    return "exact";
  }

  const expectedDomain = normalizedExpected.includes("@")
    ? normalizedExpected.split("@")[1]
    : normalizedExpected;
  if (expectedDomain && normalizedFrom.includes(expectedDomain)) {
    return "domain";
  }

  return "none";
}

function extractCode(text: string): { code: string; nearKeyword: boolean } | null {
  const nearKeywordMatch = text.match(CODE_NEAR_KEYWORD_PATTERN);
  if (nearKeywordMatch) {
    const digitsOnly = nearKeywordMatch[1]!.replace(/[\s-]/g, "");
    if (digitsOnly.length >= 4 && digitsOnly.length <= 8) {
      return { code: digitsOnly, nearKeyword: true };
    }
  }

  const genericMatch = text.match(GENERIC_CODE_PATTERN);
  if (genericMatch) {
    return { code: genericMatch[1]!, nearKeyword: false };
  }

  return null;
}

const CONFIDENCE_RANK: Record<CodeConfidence, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * Filtra e escolhe o melhor candidato a codigo de verificacao entre varias
 * mensagens. Deliberadamente NAO usa apenas "a mensagem mais recente":
 * elimina mensagens antigas (antes de requestedAt), encaminhamentos, codigos
 * ja usados, confiança LOW (lixo comum em catch-all), e prioriza
 * remetente/assunto batendo com o esperado.
 */
export function extractVerificationCode(
  messages: GmailMessage[],
  criteria: CodeFilterCriteria,
): CodeCandidate | null {
  const usedCodes = criteria.usedCodes ?? new Set<string>();
  const minConfidence = criteria.minConfidence ?? "MEDIUM";
  const minRank = CONFIDENCE_RANK[minConfidence];

  const candidates: Array<CodeCandidate & { receivedAt: Date; score: number }> = [];

  for (const message of messages) {
    if (message.receivedAt.getTime() < criteria.requestedAt.getTime()) {
      continue; // mensagem antiga, anterior a solicitacao do codigo
    }

    if (isForwarded(message.subject)) {
      continue;
    }

    const hasSubjectMatch = subjectMatchesKeywords(message.subject);
    const senderMatch = senderMatches(message.from, criteria.expectedSender);

    if (!hasSubjectMatch && senderMatch === "none") {
      continue; // nada indica que essa mensagem seja sobre o cadastro atual
    }

    const text = `${message.subject}\n${message.bodyText ?? message.snippet}`;
    const extracted = extractCode(text);
    if (!extracted) continue;
    if (usedCodes.has(extracted.code)) continue;

    let score = 0;
    if (senderMatch === "exact") score += 4;
    else if (senderMatch === "domain") score += 2;
    if (hasSubjectMatch) score += 2;
    if (extracted.nearKeyword) score += 1;
    if (
      criteria.expectedRecipient &&
      text.toLowerCase().includes(criteria.expectedRecipient.trim().toLowerCase())
    ) {
      score += 5;
    }

    let confidence: CodeConfidence;
    if (score >= 6) confidence = "HIGH";
    else if (score >= 3) confidence = "MEDIUM";
    else confidence = "LOW";

    // Catch-all / caixa compartilhada: LOW quase sempre é número genérico
    // (****00 etc.) — Uber rejeita e queima a rodada de Resend.
    if (CONFIDENCE_RANK[confidence] < minRank) {
      continue;
    }

    candidates.push({
      code: extracted.code,
      confidence,
      messageId: message.id,
      receivedAt: message.receivedAt,
      score,
    });
  }

  if (candidates.length === 0) return null;

  // Empate de score → mensagem MAIS NOVA (código antigo já usado quebra o OTP).
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.receivedAt.getTime() - a.receivedAt.getTime();
  });

  const best = candidates[0]!;
  return { code: best.code, confidence: best.confidence, messageId: best.messageId };
}
