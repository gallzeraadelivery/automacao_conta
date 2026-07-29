import type { PageType } from "./types";

/**
 * Cada checagem combina o marcador explicito que as paginas mock da Fase 3
 * expoem (`data-step-type`, `data-testid`) com padroes de texto genericos
 * (PT/EN) para generalizar para paginas reais que nao tem essa
 * instrumentacao de teste.
 */
const PROFILE_PHOTO_PATTERNS = [
  /data-step-type=["']profile-photo["']/i,
  /\bselfie\b/i,
  /foto\s+de\s+perfil/i,
  /profile\s+photo/i,
];

const DRIVER_LICENSE_PATTERNS = [
  /data-step-type=["']driver-license["']/i,
  /driver'?s?\s+licen[cs]e/i,
  /carteira\s+(de\s+)?(motorista|habilita[cç][aã]o)/i,
  /\bcnh\b/i,
];

const CAPTCHA_PATTERNS = [
  /data-testid=["']captcha-page["']/i,
  // "recaptcha" (nao so "captcha" isolado - a palavra sozinha aparece com
  // frequencia demais em links/menus de navegacao/teste sem ser o desafio
  // em si, o que gerava falso positivo na propria pagina de login do mock).
  /recaptcha/i,
  /g-recaptcha/i,
  /n[aã]o\s+sou\s+um\s+rob[oô]/i,
  /i'?m\s+not\s+a\s+robot/i,
];

const TWO_FACTOR_PATTERNS = [
  /data-testid=["']two-factor-page["']/i,
  /two[- ]factor\s+auth/i,
  // "2fa" sozinho (sem contexto de autenticacao) e comum demais em
  // links/menus de navegacao (ex: nosso proprio seletor de cenarios de
  // teste) para ser um sinal confiavel isolado - so conta combinado com
  // "auth"/"verification"/"código" por perto.
  /2fa\s*(auth|verification|c[oó]digo)/i,
  /(auth|verification|c[oó]digo).{0,20}2fa/i,
  /autentica[cç][aã]o\s+em\s+duas\s+etapas/i,
  /dois\s+fatores/i,
];

const SECURITY_BLOCK_PATTERNS = [
  /data-testid=["']security-block-page["']/i,
  /atividade\s+suspeita/i,
  /conta\s+(foi\s+)?bloqueada/i,
  /account\s+(has\s+been\s+)?blocked/i,
  /suspicious\s+activity/i,
];

function matchesAny(html: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(html));
}

export function isCaptchaPage(html: string): boolean {
  return matchesAny(html, CAPTCHA_PATTERNS);
}

export function isTwoFactorPage(html: string): boolean {
  return matchesAny(html, TWO_FACTOR_PATTERNS);
}

export function isSecurityBlockPage(html: string): boolean {
  return matchesAny(html, SECURITY_BLOCK_PATTERNS);
}

export function isProfilePhotoPage(html: string): boolean {
  return matchesAny(html, PROFILE_PHOTO_PATTERNS);
}

export function isDriverLicensePage(html: string): boolean {
  return matchesAny(html, DRIVER_LICENSE_PATTERNS);
}

export function isVerificationPage(html: string): boolean {
  return (
    isProfilePhotoPage(html) ||
    isDriverLicensePage(html) ||
    /identity\s+verification/i.test(html) ||
    /verifica[cç][aã]o\s+de\s+identidade/i.test(html)
  );
}

/**
 * Classificacao geral do tipo de pagina - util para o worker de automacao
 * decidir o que fazer a seguir (ex: mapear CAPTCHA/2FA/bloqueio para os
 * motivos nao-retentaveis de `apps/worker`). Checa paginas de desafio
 * primeiro para evitar falso-positivo (ex: uma pagina de bloqueio que
 * tambem menciona "verificacao" de forma generica).
 */
export function classifyPageType(html: string): PageType {
  if (isSecurityBlockPage(html)) return "SECURITY_BLOCK";
  if (isCaptchaPage(html)) return "CAPTCHA";
  if (isTwoFactorPage(html)) return "TWO_FACTOR";
  if (isDriverLicensePage(html)) return "DRIVER_LICENSE";
  if (isProfilePhotoPage(html)) return "PROFILE_PHOTO";
  return "UNKNOWN";
}
