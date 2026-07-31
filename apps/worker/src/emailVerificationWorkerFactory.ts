import { EmailVerificationWorker } from "@uber-automation/email-service";
import type { AuditLogger } from "@uber-automation/security";
import type { BrowserProfileManager } from "@uber-automation/automation";
import { resolveProxyConnection } from "./proxyConnection";
import { saveDebugScreenshot } from "./screenshotStorage";

/**
 * `EmailVerificationWorker` só recebe `companyId` na construção (usado
 * apenas para correlacionar seus próprios audit logs) - uma instância
 * compartilhada entre empresas diferentes (multi-tenant) não tem como
 * acertar esse valor para todo mundo. Por isso é sempre construída aqui,
 * uma vez por job, escopada à empresa daquele job específico - nunca como
 * singleton no módulo. Mesmo motivo/mesmo padrão de `BrowserProfileManager`
 * em uberAutomationRunner.ts.
 */
export function createScopedEmailVerificationWorker(
  companyId: string,
  auditLogger: AuditLogger,
  browserProfileManager: BrowserProfileManager,
): EmailVerificationWorker {
  return new EmailVerificationWorker({
    auditLogger,
    companyId,
    // Faltava isso: sem essa linha, o login no Gmail sempre acontecia sem
    // proxy nenhum, mesmo quando o motorista tinha um proxy configurado -
    // uma navegação direta do IP do servidor, diferente de toda a automação
    // principal na Uber (ver uberAutomationRunner.ts, que já aplica o
    // proxy corretamente em modo production).
    async resolveProxyConnection(proxyId) {
      const connection = await resolveProxyConnection(proxyId);
      return connection ?? undefined;
    },
    // Sem screenshot aqui, uma falha no login do Gmail (ex: bloqueio de
    // automação do próprio Google) não deixava nenhum rastro visual - só a
    // automação principal na Uber tinha isso (ver captureDebugScreenshot em
    // uberAutomationRunner.ts). Tag "EMAIL" para diferenciar no nome do
    // arquivo dos screenshots da automação principal (tag é o status:
    // PAUSED/ERROR/etc).
    async captureDebugScreenshot(applicantId, buffer) {
      return saveDebugScreenshot(buffer, applicantId, "EMAIL");
    },
    browserProfileHooks: {
      async loadGmailSession(applicantId) {
        const profileId = await browserProfileManager.getActiveProfileId(applicantId);
        if (!profileId) return undefined;

        const validation = await browserProfileManager.validateProfileDetailed(profileId);
        if (!validation.valid) return undefined;

        const loaded = await browserProfileManager.loadProfile(profileId).catch(() => null);
        if (!loaded) return undefined;
        return { cookies: loaded.data.gmail.cookies, localStorage: loaded.data.gmail.localStorage };
      },
      async saveGmailSession() {
        // Persistencia da sessao do Gmail de volta no BrowserProfileManager
        // (gravar cookies/localStorage em disco) e um refinamento futuro.
      },
      async lockOnSecurityChallenge(applicantId, reason) {
        const profileId = await browserProfileManager.getActiveProfileId(applicantId);
        if (profileId) {
          await browserProfileManager.lockProfile(profileId, reason).catch(() => undefined);
        }
      },
    },
  });
}
