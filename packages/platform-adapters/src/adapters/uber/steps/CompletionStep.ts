import type { StepContext } from "../../types";
import type { UberAdapterConfig } from "../config";
import type { UberSelectors } from "../selectors";

/**
 * Executado quando o loop de "continuar pelas etapas administrativas" não
 * encontra mais nenhuma etapa sensível nem botão "Continuar" - assume-se
 * que o cadastro administrativo terminou nesta sessão (ex: uma página de
 * "cadastro em análise"). Apenas registra em auditoria; não preenche nem
 * envia nada.
 */
export async function runCompletionStep(
  ctx: StepContext<UberAdapterConfig, UberSelectors>,
): Promise<void> {
  await ctx.recordStep("COMPLETION", { url: ctx.page.url() });
}
