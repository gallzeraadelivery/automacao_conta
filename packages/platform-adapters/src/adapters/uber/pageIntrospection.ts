import type { Page } from "playwright";

export interface PageSnapshot {
  url: string;
  html: string;
  scripts: string[];
  resources: string[];
}

/**
 * Captura os sinais visíveis na página atual (URL, HTML, scripts, recursos
 * carregados) para alimentar o VerificationFlowDetector (Fase 4). Não
 * interage com a página além de ler seu conteúdo - nenhum clique, nenhum
 * preenchimento.
 */
export async function capturePageSnapshot(page: Page): Promise<PageSnapshot> {
  const [html, scripts, resources] = await Promise.all([
    page.content(),
    page.evaluate(() =>
      Array.from(document.scripts).map((script) => script.src || script.textContent || ""),
    ),
    page.evaluate(() =>
      Array.from(document.querySelectorAll("[src]"))
        .map((element) => element.getAttribute("src"))
        .filter((src): src is string => Boolean(src)),
    ),
  ]);

  return { url: page.url(), html, scripts, resources };
}
