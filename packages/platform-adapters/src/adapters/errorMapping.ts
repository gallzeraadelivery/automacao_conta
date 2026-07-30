import { AutomationPauseSignal, AutomationTechnicalError } from "../types";

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || /timeout/i.test(error.message);
}

/**
 * Converte um erro cru do Playwright (ou qualquer outro) numa
 * `AutomationTechnicalError` com um código estável, para que o chamador
 * (`PlatformAdapter.start()`) devolva um `AutomationResult` com status
 * `ERROR` em vez de deixar a exceção vazar sem contexto. Erros que já são
 * `AutomationPauseSignal`/`AutomationTechnicalError` são relançados sem
 * modificação - eles já carregam o motivo correto.
 */
export function toTechnicalError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): AutomationTechnicalError {
  if (error instanceof AutomationTechnicalError) return error;
  if (error instanceof AutomationPauseSignal) throw error;

  const message = error instanceof Error ? error.message : String(error);
  const code = isTimeoutError(error) ? "ELEMENT_TIMEOUT" : fallbackCode;
  return new AutomationTechnicalError(code, `${fallbackMessage}: ${message}`);
}
