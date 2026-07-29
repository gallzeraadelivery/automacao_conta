export interface ProviderDefinition {
  key: string;
  label: string;
  /** Nomes/palavras que, se encontrados no texto/titulo/atributo, indicam este provedor. */
  names: string[];
  /** Dominios oficiais (match exato ou subdominio). */
  domains: string[];
}

export const SOCURE: ProviderDefinition = {
  key: "SOCURE",
  label: "Socure",
  names: ["socure"],
  domains: ["socure.com"],
};

export const UBER: ProviderDefinition = {
  key: "UBER",
  label: "Uber",
  names: ["uber"],
  domains: ["uber.com"],
};

/**
 * Provedores de verificacao de identidade concorrentes conhecidos, citados
 * como exemplo no briefing da Fase 4, mais o provedor simulado pela Fase 3
 * ("Verificador XYZ" / verificador-xyz.com). Esta lista NAO precisa ser
 * exaustiva: nomes/dominios de terceiros nao listados aqui ainda sao
 * detectados via padroes genericos (ex: "Powered by X", `data-provider`),
 * apenas com um metodo de deteccao diferente.
 */
export const KNOWN_OTHER_PROVIDERS: ProviderDefinition[] = [
  { key: "IDOLOGY", label: "IDology", names: ["idology"], domains: ["idology.com"] },
  { key: "JUMIO", label: "Jumio", names: ["jumio"], domains: ["jumio.com"] },
  { key: "ONFIDO", label: "Onfido", names: ["onfido"], domains: ["onfido.com"] },
  { key: "VERIFF", label: "Veriff", names: ["veriff"], domains: ["veriff.com"] },
  {
    key: "PERSONA",
    label: "Persona",
    names: ["persona"],
    domains: ["withpersona.com", "persona.com"],
  },
  { key: "TRULIOO", label: "Trulioo", names: ["trulioo"], domains: ["trulioo.com"] },
  { key: "MITEK", label: "Mitek", names: ["mitek"], domains: ["mitek.com"] },
  {
    key: "VERIFICADOR_XYZ",
    label: "Verificador XYZ",
    names: ["verificador xyz", "verificador-xyz", "verificadorxyz"],
    domains: ["verificador-xyz.com"],
  },
];

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

export function domainMatchesProvider(domain: string, provider: ProviderDefinition): boolean {
  const normalized = normalizeDomain(domain);
  return provider.domains.some(
    (candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`),
  );
}

export function matchProviderByDomain(domain: string): ProviderDefinition | null {
  if (domainMatchesProvider(domain, SOCURE)) return SOCURE;
  for (const provider of KNOWN_OTHER_PROVIDERS) {
    if (domainMatchesProvider(domain, provider)) return provider;
  }
  return null;
}

export function nameMatchesProvider(text: string, provider: ProviderDefinition): boolean {
  const normalized = text.toLowerCase();
  return provider.names.some((name) =>
    new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(normalized),
  );
}

export function matchProviderByName(text: string): ProviderDefinition | null {
  if (nameMatchesProvider(text, SOCURE)) return SOCURE;
  for (const provider of KNOWN_OTHER_PROVIDERS) {
    if (nameMatchesProvider(text, provider)) return provider;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
