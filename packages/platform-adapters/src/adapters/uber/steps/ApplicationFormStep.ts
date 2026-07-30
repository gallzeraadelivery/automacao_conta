import type { Page } from "playwright";
import { toTechnicalError } from "../../errorMapping";
import type { StepContext } from "../../types";
import type { UberAdapterConfig } from "../config";
import type { FieldSelector, UberSelectors } from "../selectors";

async function fillField(
  page: Page,
  field: FieldSelector,
  value: string,
  timeout: number,
): Promise<void> {
  if (field.kind === "select") {
    await page.selectOption(field.selector, value, { timeout });
  } else {
    await page.fill(field.selector, value, { timeout });
  }
}

/**
 * Preenche apenas dados administrativos (nome, e-mail, telefone, endereço,
 * cidade, estado, CEP, tipo de veículo) - nenhum campo de documento/foto.
 */
export async function runApplicationFormStep(
  ctx: StepContext<UberAdapterConfig, UberSelectors>,
): Promise<void> {
  const { page, config, selectors, context } = ctx;
  const { applicantData } = context;
  const timeout = config.timeouts.elementWait;
  const fields = selectors.applicationForm;

  try {
    await page.fill(fields.fullNameInput, applicantData.fullName, { timeout });
    await page.fill(fields.emailInput, applicantData.email, { timeout });
    await page.fill(fields.phoneInput, applicantData.phone, { timeout });
    await page.fill(fields.addressInput, applicantData.address, { timeout });
    await page.fill(fields.cityInput, applicantData.city, { timeout });
    await fillField(page, fields.stateField, applicantData.state, timeout);
    await page.fill(fields.postalCodeInput, applicantData.postalCode, { timeout });
    await fillField(page, fields.vehicleTypeField, applicantData.vehicleType, timeout);
    await page.click(fields.submitButton, { timeout });
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeouts.pageLoad });
  } catch (error) {
    throw toTechnicalError(
      error,
      "ELEMENT_NOT_FOUND",
      "Falha ao preencher o formulário de cadastro",
    );
  }

  await ctx.recordStep("FORM_FILLED", {
    city: applicantData.city,
    state: applicantData.state,
    vehicleType: applicantData.vehicleType,
  });
}
