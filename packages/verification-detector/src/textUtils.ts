/**
 * Extrai o hostname de uma URL completa ou de uma string "solta" que
 * referencia um recurso (ex: "cdn.socure.com/verify.js", sem protocolo).
 * Retorna null quando nao ha nada parecido com um dominio.
 */
export function extractDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    // sem protocolo (ex: "cdn.socure.com/verify.js" ou "socure.com")
  }

  try {
    return new URL(`https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const TITLE_PATTERN = /<title>([^<]*)<\/title>/i;

export function extractTitle(html: string): string | null {
  const match = html.match(TITLE_PATTERN);
  return match ? match[1]!.trim() : null;
}

/**
 * Extrai os `src` de tags <script> presentes no HTML. Usado como fallback
 * quando o chamador nao tem a lista de scripts pre-extraida (ex: quando so
 * dispoe do HTML bruto via `page.content()`).
 */
export function extractScriptSrcs(html: string): string[] {
  const matches = html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi);
  return [...matches].map((match) => match[1]!);
}

export function extractAttribute(html: string, attribute: string): string | null {
  const match = html.match(new RegExp(`${attribute}=["']([^"']+)["']`, "i"));
  return match ? match[1]! : null;
}

export function extractTextByTestId(html: string, testId: string): string | null {
  const pattern = new RegExp(`data-testid=["']${testId}["'][^>]*>([^<]*)<`, "i");
  const match = html.match(pattern);
  return match ? match[1]!.trim() : null;
}
