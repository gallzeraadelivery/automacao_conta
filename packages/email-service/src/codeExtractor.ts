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
  "welcome to uber",
];

const FORWARD_PREFIXES = ["fwd:", "fw:", "enc:", "encaminhar:", "encaminhado:"];

/**
 * Codigo perto de uma palavra-chave, ex: "codigo: 482913", "code is 482913",
 * "Verification code: 8606". Janela generosa: HTML da Uber (após strip)
 * ainda pode deixar gap entre o label e o <p>NNNN</p>.
 */
const CODE_NEAR_KEYWORD_PATTERN =
  /(?:verification\s*code|c[oó]digo(?:\s+de\s+verifica[cç][aã]o)?|code|otp|pin)\D{0,120}(\d[\d\s-]{2,9}\d)/i;
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

function messageMentionsRecipient(message: GmailMessage, expectedRecipient: string): boolean {
  const needle = expectedRecipient.trim().toLowerCase();
  if (!needle) return false;
  const text = `${message.subject}\n${message.bodyText ?? message.snippet}`.toLowerCase();
  if (text.includes(needle)) return true;
  for (const addr of message.toAddresses ?? []) {
    if (addr === needle || addr.includes(needle)) return true;
  }
  return false;
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
    // Tolerância de 5 min antes do requestedAt: a Uber pode enviar o OTP
    // antes do resend ser disparado e o "novo" e-mail pós-resend pode não
    // conter código (ex: "Welcome to Uber" sem OTP).
    const AGE_TOLERANCE_MS = 5 * 60_000;
    if (message.receivedAt.getTime() < criteria.requestedAt.getTime() - AGE_TOLERANCE_MS) {
      continue;
    }

    if (isForwarded(message.subject)) {
      continue;
    }

    const hasSubjectMatch = subjectMatchesKeywords(message.subject);
    const senderMatch = senderMatches(message.from, criteria.expectedSender);

    // Com remetente esperado (Uber), exige domínio Uber — assunto genérico
    // ("confirmation", "verify") sozinho pega marketing de outros serviços.
    if (criteria.expectedSender && senderMatch === "none") {
      continue;
    }

    if (!hasSubjectMatch && senderMatch === "none") {
      continue; // nada indica que essa mensagem seja sobre o cadastro atual
    }

    const text = `${message.subject}\n${message.bodyText ?? message.snippet}`;
    const extracted = extractCode(text);
    if (!extracted) continue;
    // Catch-all: só aceita código explícito (perto de "code"/"otp") — ignora
    // números soltos em promoções, telefones, datas em outros e-mails.
    if (criteria.expectedRecipient && !extracted.nearKeyword) {
      continue;
    }
    if (usedCodes.has(extracted.code)) continue;

    const recipientMatch =
      !!criteria.expectedRecipient &&
      messageMentionsRecipient(message, criteria.expectedRecipient);
    // Catch-all com vários OTPs na mesma caixa: sem match de destinatário
    // ignora — evita digitar código de outro alias (MEDIUM falso positivo).
    if (criteria.expectedRecipient && !recipientMatch) {
      continue;
    }

    let score = 0;
    if (senderMatch === "exact") score += 4;
    else if (senderMatch === "domain") score += 2;
    if (hasSubjectMatch) score += 2;
    if (extracted.nearKeyword) score += 1;
    if (recipientMatch) score += 5;

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
