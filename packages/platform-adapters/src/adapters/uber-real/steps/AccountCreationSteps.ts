import { toTechnicalError } from "../../errorMapping";
import { AutomationPauseSignal, AutomationTechnicalError } from "../../../types";
import { SecurityChallengeError, VerificationCodeNotFoundError } from "@uber-automation/email-service";
import { maskCode } from "@uber-automation/security";
import { buildPlaceholderPassword, buildPlaceholderPhone, splitFullName } from "../nameUtils";
import type { RealStepContext } from "../realStepContext";

/**
 * Passo 1 (PDF): abre o portal de cadastro.
 */
export async function openDriversPortal(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await page.goto(config.driversBaseUrl, {
      timeout: config.timeouts.pageLoad,
      waitUntil: "domcontentloaded",
    });
  } catch (error) {
    throw toTechnicalError(error, "PAGE_LOAD_TIMEOUT", "Falha ao carregar drivers.uber.com");
  }
  await ctx.recordStep("PORTAL_OPENED");
}

/**
 * Passo 2 (PDF): tela "Qual é o seu número de telefone ou e-mail?" /
 * "What's your phone number or email?" - a tela inicial pode aparecer em
 * PT-BR ou EN dependendo do IP/proxy, por isso o botão é localizado por
 * texto EXATO ("Continuar"/"Continue"), não por substring - senão bateria
 * também em "Continuar com o Google"/"Continuar com a Apple".
 */
export async function fillIdentifierStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  try {
    const emailInput = page
      .locator('input[type="email"], input[type="text"], input[type="tel"]')
      .first();
    await emailInput.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await emailInput.fill(context.applicantData.email);

    const continueButton = page.getByRole("button", { name: /^(continuar|continue)$/i }).first();
    await continueButton.click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
    if (config.timeouts.actionDelay > 0) await page.waitForTimeout(config.timeouts.actionDelay);
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher e-mail/telefone inicial");
  }
  await ctx.recordStep("IDENTIFIER_SUBMITTED");
}

/**
 * Passo 3 (PDF): "Enter the 4-digit code sent to you at: [email]" - 4 caixas
 * de 1 dígito cada, com auto-avanço de foco (padrão comum de OTP). Em vez
 * de tentar mirar cada caixa individualmente (seletor desconhecido), clica
 * na primeira e digita a sequência inteira via teclado - o auto-avanço da
 * própria página cuida do resto.
 */
export async function fillEmailCodeStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config, emailWorker } = ctx;

  let code: string;
  try {
    const result = await emailWorker.findVerificationCode({
      applicantId: context.applicantId,
      emailAccountId: context.emailAccountId,
      proxyId: context.proxyId,
      requestedAt: new Date(),
      expectedSender: "noreply@uber.com",
    });
    code = result.code;
  } catch (error) {
    if (error instanceof SecurityChallengeError) {
      throw new AutomationPauseSignal(
        error.challenge === "PHONE_VERIFICATION" ? "SECURITY_BLOCK" : error.challenge,
      );
    }
    if (error instanceof VerificationCodeNotFoundError) {
      throw new AutomationTechnicalError("EMAIL_CODE_NOT_FOUND", error.message);
    }
    throw toTechnicalError(error, "EMAIL_CODE_RETRIEVAL_FAILED", "Falha ao buscar código de e-mail");
  }

  await ctx.recordStep("CODE_RETRIEVED", { maskedValue: maskCode(code) });

  try {
    const firstBox = page.locator('input[maxlength="1"], input[inputmode="numeric"]').first();
    await firstBox.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await firstBox.click();
    await page.keyboard.type(code, { delay: 75 });

    const nextButton = page.getByRole("button", { name: /^next$/i });
    // Alguns fluxos avancam sozinhos assim que o 4o digito e digitado.
    if (await nextButton.isEnabled().catch(() => false)) {
      await nextButton.click({ timeout: config.timeouts.elementWait });
    }
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher código de verificação");
  }
  await ctx.recordStep("EMAIL_VERIFIED");
}

/**
 * Passo 4 (PDF): "Enter your mobile number" - o país já vem em "US". O
 * número digitado é SEMPRE um placeholder (nunca o telefone real do
 * motorista) - o atendente corrige na finalização do cadastro (confirmado
 * pelo usuário). Ver `buildPlaceholderPhone`.
 */
export async function fillPhoneStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  const phone = buildPlaceholderPhone(context.applicantId);

  try {
    const phoneInput = page.locator('input[type="tel"], input[type="text"]').last();
    await phoneInput.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await phoneInput.fill(phone);
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher telefone placeholder");
  }
  // Nunca logar o numero completo (mesmo sendo placeholder, e um habito de
  // seguranca consistente com o resto do sistema - nunca dado sensivel em claro).
  await ctx.recordStep("PHONE_SUBMITTED", { placeholder: true });
}

/**
 * Passo 5 (PDF): "Create your account password" - Sobrenome + sufixo fixo
 * (ex: "Silva@2026"), decisão explícita do operador. A senha nunca é
 * registrada em auditoria/logs.
 */
export async function fillPasswordStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  const password = buildPlaceholderPassword(context.applicantData.fullName, config.passwordSuffix);

  try {
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.waitFor({ state: "visible", timeout: config.timeouts.elementWait });
    await passwordInput.fill(password);
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher senha");
  }
  await ctx.recordStep("PASSWORD_SUBMITTED");
}

/**
 * Passo 6 (PDF): formulário de nome/sobrenome. Os rótulos exatos não
 * puderam ser confirmados nos prints (só o texto "Formulário com campos de
 * nome") - tenta rótulos comuns do padrão Uber, com fallback estrutural
 * (dois primeiros inputs de texto visíveis da tela) se nenhum rótulo bater.
 */
export async function fillNameStep(ctx: RealStepContext): Promise<void> {
  const { page, context, config } = ctx;
  const { firstName, lastName } = splitFullName(context.applicantData.fullName);

  try {
    const firstNameInput = await firstAvailable(page, [
      page.getByLabel(/first name/i),
      page.getByPlaceholder(/first name/i),
    ]);
    const lastNameInput = await firstAvailable(page, [
      page.getByLabel(/last name/i),
      page.getByPlaceholder(/last name/i),
    ]);

    if (firstNameInput && lastNameInput) {
      await firstNameInput.fill(firstName);
      await lastNameInput.fill(lastName);
    } else {
      // Fallback estrutural: primeiros dois inputs de texto visiveis da tela.
      const textInputs = page.locator('input[type="text"]');
      await textInputs.nth(0).fill(firstName);
      await textInputs.nth(1).fill(lastName);
    }

    await page.getByRole("button", { name: /^next$/i }).click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", "Falha ao preencher nome/sobrenome");
  }
  await ctx.recordStep("NAME_SUBMITTED");
}

/**
 * Passo 7 (PDF): "Accept Uber's Terms & Review Privacy Notice" - marca "I
 * agree" e clica "Next".
 */
export async function acceptTermsStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    await page.getByText(/^i agree$/i).click({ timeout: config.timeouts.elementWait });
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: config.timeouts.elementWait });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(error, "ELEMENT_NOT_FOUND", 'Falha ao aceitar termos ("I agree")');
  }
  await ctx.recordStep("TERMS_ACCEPTED");
}

/**
 * Passo 8 (PDF): tela "All set!" - às vezes avança sozinha ("If nothing
 * happens, click continue"), por isso o clique em "Continue" é best-effort
 * (não falha se a tela já tiver avançado).
 */
export async function confirmAllSetStep(ctx: RealStepContext): Promise<void> {
  const { page, config } = ctx;
  try {
    const continueButton = page.getByRole("button", { name: /^continue$/i });
    await continueButton.waitFor({ state: "visible", timeout: 5000 });
    await continueButton.click({ timeout: config.timeouts.elementWait });
  } catch {
    // Tela pode ja ter avancado sozinha - nao e uma falha.
  }
  await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad }).catch(() => undefined);
  await ctx.recordStep("ACCOUNT_CREATED");
}

async function firstAvailable(
  page: RealStepContext["page"],
  locators: ReturnType<RealStepContext["page"]["getByLabel"]>[],
) {
  for (const locator of locators) {
    if ((await locator.count().catch(() => 0)) > 0) return locator.first();
  }
  return null;
}
