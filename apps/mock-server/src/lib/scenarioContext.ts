import type { Request } from "express";
import { DEFAULT_SCENARIO, isScenario, type Scenario } from "../scenarios";

/**
 * Resolve o cenario ativo: se `?scenario=` vier na URL e for valido, ele
 * passa a ser o cenario da sessao (permite trocar a qualquer momento do
 * fluxo). Caso contrario, usa o que ja estava salvo, com um padrao.
 */
export function resolveScenario(req: Request): Scenario {
  const queryScenario = req.query.scenario;
  if (isScenario(queryScenario)) {
    req.session.scenario = queryScenario;
    return queryScenario;
  }
  return req.session.scenario ?? DEFAULT_SCENARIO;
}

export function scenarioQueryString(scenario: Scenario): string {
  return `?scenario=${scenario}`;
}

/** Pequeno atraso artificial para simular latencia de rede real. */
export function simulateNetworkDelay(): Promise<void> {
  const ms = 250 + Math.floor(Math.random() * 350);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
