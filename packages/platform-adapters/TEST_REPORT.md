# Relatório de testes - UberDriverApplicationAdapter vs. mock-server (Fase 3)

Gerado executando o adaptador real (login → formulário → verificação de e-mail → detecção da etapa terminal) com um Chromium headless real via Playwright, contra o HTML real renderizado por `apps/mock-server` (não fixtures escritas à mão) - reflete exatamente o que a automação faria contra a Uber real, só que apontando `baseUrl`/seletores para o mock em vez do site real (ver `src/adapters/uber/mockUberConfig.ts`).

**Taxa de acerto: 8/8 (100%)**

## Cenários (login → formulário → e-mail → etapa terminal)

| Cenário                           | Esperado                                                         | Obtido                                                           | OK? |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | --- |
| Foto de perfil - Socure           | VERIFICATION_DETECTED / SOCURE / IDENTITY_VERIFICATION_REQUIRED  | VERIFICATION_DETECTED / SOCURE / IDENTITY_VERIFICATION_REQUIRED  | ✅  |
| Foto de perfil - outro provedor   | VERIFICATION_DETECTED / NOT_SOCURE / NON_SOCURE_PROVIDER         | VERIFICATION_DETECTED / NOT_SOCURE / NON_SOCURE_PROVIDER         | ✅  |
| Foto de perfil - desconhecido     | VERIFICATION_DETECTED / UNKNOWN / IDENTITY_VERIFICATION_REQUIRED | VERIFICATION_DETECTED / UNKNOWN / IDENTITY_VERIFICATION_REQUIRED | ✅  |
| CNH - Socure                      | VERIFICATION_DETECTED / SOCURE / IDENTITY_VERIFICATION_REQUIRED  | VERIFICATION_DETECTED / SOCURE / IDENTITY_VERIFICATION_REQUIRED  | ✅  |
| CNH - outro provedor              | VERIFICATION_DETECTED / NOT_SOCURE / NON_SOCURE_PROVIDER         | VERIFICATION_DETECTED / NOT_SOCURE / NON_SOCURE_PROVIDER         | ✅  |
| CAPTCHA                           | VERIFICATION_DETECTED / UNKNOWN / CAPTCHA                        | VERIFICATION_DETECTED / UNKNOWN / CAPTCHA                        | ✅  |
| Autenticação em duas etapas (2FA) | VERIFICATION_DETECTED / UNKNOWN / TWO_FACTOR                     | VERIFICATION_DETECTED / UNKNOWN / TWO_FACTOR                     | ✅  |
| Bloqueio de segurança             | VERIFICATION_DETECTED / UNKNOWN / SECURITY_BLOCK                 | VERIFICATION_DETECTED / UNKNOWN / SECURITY_BLOCK                 | ✅  |

## Cobertura adicional (fora deste script, ver `uberDriverApplicationAdapter.test.ts`)

Estes três casos exigem controlar precisamente o HTML da página (nenhum marcador sensível) ou corromper uma credencial - não fazem sentido como cenário de mock-server e são cobertos pela suíte de testes (`pnpm --filter @uber-automation/platform-adapters test`), não por este gerador:

- **Fluxo completo (login → formulário → e-mail → etapa terminal reconhecida)**: valida a progressão de `currentStep` a cada passo usando o cenário `photo-socure` contra o mock-server real.
- **SUCCESS/conclusão sem etapa sensível**: o mock-server não tem, de propósito, nenhuma página de sucesso real (nenhum bypass legítimo existe) - testado com um double mínimo de `Page` (`FakePage`) que nunca sai de uma página administrativa genérica, para validar `CompletionStep` isoladamente.
- **ERROR ao descriptografar uma credencial corrompida**: garante que uma falha técnica (ex: credencial corrompida, seletor desatualizado, timeout) vira um `AutomationResult` com `status: 'ERROR'` e um código estável, em vez de lançar uma exceção sem contexto.
