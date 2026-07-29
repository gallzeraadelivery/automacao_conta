import type { Confidence, DetectionMethod, ProviderClassification } from "./types";
import { KNOWN_OTHER_PROVIDERS, SOCURE, UBER, type ProviderDefinition } from "./providerRegistry";
import type { Signal } from "./signals";

export interface ClassificationResult {
  provider: ProviderClassification;
  confidence: Confidence;
  detectedDomain?: string;
  detectionMethod: DetectionMethod;
  signals: string[];
}

const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  [SOCURE.key]: SOCURE,
  [UBER.key]: UBER,
  ...Object.fromEntries(KNOWN_OTHER_PROVIDERS.map((p) => [p.key, p])),
};

function isKnownOtherProviderKey(key: string): boolean {
  return KNOWN_OTHER_PROVIDERS.some((p) => p.key === key);
}

/**
 * Escolhe a classificacao final a partir dos sinais coletados, em ordem de
 * prioridade: evidencia forte de Socure > evidencia forte de outro provedor
 * nomeado > evidencia forte de "algum" outro provedor (ex: atributo
 * explicito sem nome catalogado) > aviso explicito de ambiguidade > sinal
 * fraco de outro provedor > dominio da propria Uber > nenhuma evidencia.
 */
export function classifySignals(signals: Signal[]): ClassificationResult {
  const allEvidence = signals.map((s) => s.evidence);

  const strongSocure = signals.find((s) => s.strength === "STRONG" && s.providerKey === "SOCURE");
  if (strongSocure) {
    return {
      provider: "SOCURE",
      confidence: "HIGH",
      detectedDomain: strongSocure.domain ?? SOCURE.domains[0],
      detectionMethod: strongSocure.method,
      signals: allEvidence,
    };
  }

  const strongNamedOther = signals.find(
    (s) => s.strength === "STRONG" && isKnownOtherProviderKey(s.providerKey),
  );
  if (strongNamedOther) {
    const definition = PROVIDER_DEFINITIONS[strongNamedOther.providerKey];
    return {
      provider: "NOT_SOCURE",
      confidence: "HIGH",
      detectedDomain: strongNamedOther.domain ?? definition?.domains[0],
      detectionMethod: strongNamedOther.method,
      signals: allEvidence,
    };
  }

  const strongGenericOther = signals.find(
    (s) => s.strength === "STRONG" && s.providerKey === "GENERIC_OTHER",
  );
  if (strongGenericOther) {
    return {
      provider: "NOT_SOCURE",
      confidence: "HIGH",
      detectedDomain: strongGenericOther.domain,
      detectionMethod: strongGenericOther.method,
      signals: allEvidence,
    };
  }

  const ambiguous = signals.find((s) => s.providerKey === "AMBIGUOUS");
  if (ambiguous) {
    return {
      provider: "UNKNOWN",
      confidence: "LOW",
      detectionMethod: ambiguous.method,
      signals: allEvidence,
    };
  }

  const weakGenericOther = signals.find(
    (s) => s.strength === "WEAK" && s.providerKey === "GENERIC_OTHER",
  );
  if (weakGenericOther) {
    return {
      provider: "OTHER_PROVIDER",
      confidence: "MEDIUM",
      detectedDomain: weakGenericOther.domain,
      detectionMethod: weakGenericOther.method,
      signals: allEvidence,
    };
  }

  const uberSignal = signals.find((s) => s.providerKey === "UBER");
  if (uberSignal) {
    return {
      provider: "UBER_INTERNAL",
      confidence: uberSignal.strength === "STRONG" ? "HIGH" : "MEDIUM",
      detectedDomain: uberSignal.domain ?? UBER.domains[0],
      detectionMethod: uberSignal.method,
      signals: allEvidence,
    };
  }

  return {
    provider: "UNKNOWN",
    confidence: "UNKNOWN",
    detectionMethod: "NONE",
    signals: allEvidence,
  };
}
