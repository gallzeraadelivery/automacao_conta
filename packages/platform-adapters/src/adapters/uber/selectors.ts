/**
 * Seletores CSS do fluxo de cadastro de motorista parceiro da Uber -
 * deliberadamente separados de `config.ts` (URLs/timeouts) e da lógica de
 * automação. Quando a Uber mudar o layout, o ajuste deve caber inteiramente
 * neste arquivo.
 *
 * IMPORTANTE - mesma ressalva de `config.ts`: estes seletores são a melhor
 * suposição disponível (baseados em convenções comuns de formulário HTML),
 * não puderam ser validados contra o site real neste ambiente. Confirme
 * cada um inspecionando o site real (DevTools) antes do primeiro uso em
 * produção. Exemplo de manutenção esperada quando a Uber mudar o layout:
 *
 * ```ts
 * // Antes
 * emailInput: 'input[name="email"]',
 * // Depois
 * emailInput: 'input[id="user-email"]',
 * ```
 *
 * Note que NÃO há seletores para ações de foto de perfil/selfie/CNH (ex:
 * botão de tirar foto, input de arquivo). Isso é proposital: o adaptador
 * nunca clica nesses controles nem preenche um `<input type="file">` -
 * fazer isso seria enviar uma selfie/documento de forma automatizada, o que
 * as regras de segurança obrigatórias desta automação proíbem
 * explicitamente. `ProfilePhotoStep`/`DriverLicenseStep` apenas detectam
 * que a página é uma dessas etapas e pausam - nunca interagem com ela.
 */
export interface FieldSelector {
  selector: string;
  kind: "fill" | "select";
}

export interface UberSelectors {
  login: {
    emailInput: string;
    passwordInput: string;
    submitButton: string;
    errorMessage: string;
  };
  applicationForm: {
    fullNameInput: string;
    emailInput: string;
    phoneInput: string;
    addressInput: string;
    cityInput: string;
    stateField: FieldSelector;
    postalCodeInput: string;
    vehicleTypeField: FieldSelector;
    submitButton: string;
    errorMessage: string;
  };
  emailVerification: {
    /** Alguns fluxos exigem clicar em "Enviar código" antes do campo aparecer; outros já chegam com o código enviado. Opcional de propósito. */
    requestCodeButton?: string;
    codeInput: string;
    submitButton: string;
    errorMessage: string;
  };
  /** Botão "Continuar" genérico usado entre etapas puramente administrativas (sem campos novos). */
  continueButton: string;
}

export const UBER_SELECTORS: UberSelectors = {
  login: {
    emailInput: 'input[name="email"]',
    passwordInput: 'input[name="password"]',
    submitButton: 'button[type="submit"]',
    errorMessage: '[role="alert"], .error-message',
  },
  applicationForm: {
    fullNameInput: 'input[name="full_name"]',
    emailInput: 'input[name="email"]',
    phoneInput: 'input[name="phone"]',
    addressInput: 'input[name="address"]',
    cityInput: 'input[name="city"]',
    stateField: { selector: 'select[name="state"]', kind: "select" },
    postalCodeInput: 'input[name="postal_code"]',
    vehicleTypeField: { selector: 'select[name="vehicle_type"]', kind: "select" },
    submitButton: 'button[data-testid="continue-button"]',
    errorMessage: '[role="alert"], .error-message',
  },
  emailVerification: {
    requestCodeButton: 'button:has-text("Send Code")',
    codeInput: 'input[name="verification_code"]',
    submitButton: 'button[data-testid="verify-button"]',
    errorMessage: '[role="alert"], .error-message',
  },
  continueButton: 'button:has-text("Continue")',
};
