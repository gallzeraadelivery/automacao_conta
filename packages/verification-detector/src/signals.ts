import type { DetectionMethod, VerificationDetectionContext } from "./types";
import {
  KNOWN_OTHER_PROVIDERS,
  UBER,
  matchProviderByDomain,
  matchProviderByName,
  nameMatchesProvider,
} from "./providerRegistry";
import { extractAttribute, extractDomain, extractScriptSrcs, extractTitle } from "./textUtils";
import { isVerificationPage } from "./pageType";

export interface Signal {
  method: DetectionMethod;
  /** 'SOCURE', a chave de um provedor conhecido, 'UBER', 'GENERIC_OTHER' ou 'AMBIGUOUS'. */
  providerKey: string;
  strength: "STRONG" | "WEAK";
  evidence: string;
  domain?: string;
}

const POWERED_BY_PATTERN =
  /(?:powered by|verifica(?:[cç][aã]o|do)\s*(?:por|via))\s*[:-]?\s*([A-Za-z][A-Za-z0-9 .-]{1,40})/gi;

const AMBIGUOUS_MARKERS = [
  /n[aã]o\s+[eé]\s+poss[ií]vel\s+identificar/i,
  /provedor\s+n[aã]o\s+identificado/i,
  /provider[- ]unknown/i,
  /data-provider=["']unknown["']/i,
];

function pushUnique(signals: Signal[], signal: Signal) {
  const exists = signals.some(
    (existing) => existing.method === signal.method && existing.evidence === signal.evidence,
  );
  if (!exists) signals.push(signal);
}

export function collectSignals(context: VerificationDetectionContext): Signal[] {
  const signals: Signal[] = [];
  const html = context.html ?? "";

  // 1. Dominio da URL atual
  const urlDomain = extractDomain(context.url ?? "");
  if (urlDomain) {
    const provider = matchProviderByDomain(urlDomain);
    if (provider) {
      pushUnique(signals, {
        method: "URL_DOMAIN",
        providerKey: provider.key,
        strength: "STRONG",
        evidence: `URL atual está no domínio "${urlDomain}" (${provider.label})`,
        domain: urlDomain,
      });
    } else if (urlDomainMatchesUber(urlDomain)) {
      pushUnique(signals, {
        method: "URL_DOMAIN",
        providerKey: "UBER",
        strength: "WEAK",
        evidence: `URL atual está no domínio da própria Uber ("${urlDomain}")`,
        domain: urlDomain,
      });
    }
  }

  // 2. Atributo data-provider (explicito, adicionado por paginas instrumentadas para teste)
  const dataProvider = extractAttribute(html, "data-provider");
  if (dataProvider) {
    const normalized = dataProvider.toLowerCase();
    if (normalized === "socure") {
      pushUnique(signals, {
        method: "HTML_ATTRIBUTE",
        providerKey: "SOCURE",
        strength: "STRONG",
        evidence: 'Atributo data-provider="socure" encontrado no HTML',
      });
    } else if (normalized === "unknown") {
      pushUnique(signals, {
        method: "HTML_ATTRIBUTE",
        providerKey: "AMBIGUOUS",
        strength: "STRONG",
        evidence: 'Atributo data-provider="unknown" encontrado no HTML',
      });
    } else {
      const known = KNOWN_OTHER_PROVIDERS.find((p) => nameMatchesProvider(normalized, p));
      pushUnique(signals, {
        method: "HTML_ATTRIBUTE",
        providerKey: known?.key ?? "GENERIC_OTHER",
        strength: "STRONG",
        evidence: `Atributo data-provider="${dataProvider}" encontrado no HTML (não é Socure)`,
      });
    }
  }

  // 3. Titulo da pagina
  const title = extractTitle(html);
  if (title) {
    const provider = matchProviderByName(title);
    if (provider) {
      pushUnique(signals, {
        method: "HTML_TITLE",
        providerKey: provider.key,
        strength: "STRONG",
        evidence: `Título da página menciona "${provider.label}": "${title}"`,
      });
    }
  }

  // 4. Texto visivel / nome do provedor
  const providerFromText = matchProviderByName(html);
  if (providerFromText) {
    pushUnique(signals, {
      method: "HTML_TEXT",
      providerKey: providerFromText.key,
      strength: "STRONG",
      evidence: `Texto da página menciona "${providerFromText.label}"`,
    });
  } else {
    for (const match of html.matchAll(POWERED_BY_PATTERN)) {
      const extractedName = match[1]?.trim();
      if (extractedName) {
        pushUnique(signals, {
          method: "HTML_TEXT",
          providerKey: "GENERIC_OTHER",
          strength: "WEAK",
          evidence: `Texto da página indica um provedor não catalogado: "${extractedName}"`,
        });
      }
    }
  }

  if (AMBIGUOUS_MARKERS.some((pattern) => pattern.test(html))) {
    pushUnique(signals, {
      method: "HTML_TEXT",
      providerKey: "AMBIGUOUS",
      strength: "WEAK",
      evidence: "Página contém aviso explícito de que o provedor não pôde ser identificado",
    });
  }

  // 5. Scripts (ja extraidos pelo chamador, mais fallback via regex no html)
  const scripts = [...(context.scripts ?? []), ...extractScriptSrcs(html)];
  for (const script of scripts) {
    const provider =
      matchProviderByName(script) ?? matchProviderByDomain(extractDomain(script) ?? "");
    if (provider) {
      pushUnique(signals, {
        method: "SCRIPT_NAME",
        providerKey: provider.key,
        strength: "STRONG",
        evidence: `Script carregado referencia ${provider.label}: "${script}"`,
        domain: extractDomain(script) ?? undefined,
      });
    }
  }

  // 6. Recursos carregados (imagens, chamadas de API, etc.)
  for (const resource of context.resources ?? []) {
    const domain = extractDomain(resource);
    const provider = domain ? matchProviderByDomain(domain) : matchProviderByName(resource);
    if (provider) {
      pushUnique(signals, {
        method: "RESOURCE_DOMAIN",
        providerKey: provider.key,
        strength: "STRONG",
        evidence: `Recurso carregado de ${provider.label}: "${resource}"`,
        domain: domain ?? undefined,
      });
    }
  }

  // Fallback: sabemos que e uma etapa de verificacao (texto generico
  // "identity verification"/"verificacao de identidade", etc.) mas nenhum
  // sinal acima identificou um provedor - isso e diferente de receber um
  // HTML totalmente vazio/irrelevante (esse caso fica sem nenhum sinal, e a
  // confianca final e UNKNOWN em vez de LOW).
  if (signals.length === 0 && isVerificationPage(html)) {
    pushUnique(signals, {
      method: "HTML_TEXT",
      providerKey: "AMBIGUOUS",
      strength: "WEAK",
      evidence: "Página de verificação identificada, mas nenhum provedor pôde ser determinado",
    });
  }

  return signals;
}

function urlDomainMatchesUber(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return normalized === UBER.domains[0] || normalized.endsWith(`.${UBER.domains[0]}`);
}
