import { EmailVerificationWorker } from "@uber-automation/email-service";
import type { AuditLogger } from "@uber-automation/security";
import type { BrowserProfileManager } from "@uber-automation/automation";

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
