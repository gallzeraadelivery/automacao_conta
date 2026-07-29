export const SCENARIOS = [
  "photo-socure",
  "photo-other",
  "photo-unknown",
  "license-socure",
  "license-other",
  "captcha",
  "2fa",
  "block",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

export const DEFAULT_SCENARIO: Scenario = "photo-socure";

export function isScenario(value: unknown): value is Scenario {
  return typeof value === "string" && (SCENARIOS as readonly string[]).includes(value);
}

/** Para onde o dispatcher (`/mock-uber/next-step`) redireciona cada cenário. */
export const SCENARIO_PATHS: Record<Scenario, string> = {
  "photo-socure": "/mock-uber/profile-photo-socure",
  "photo-other": "/mock-uber/profile-photo-other",
  "photo-unknown": "/mock-uber/profile-photo-unknown",
  "license-socure": "/mock-uber/driver-license-socure",
  "license-other": "/mock-uber/driver-license-other",
  captcha: "/mock-uber/captcha",
  "2fa": "/mock-uber/two-factor",
  block: "/mock-uber/security-block",
};

export const SCENARIO_LABELS: Record<Scenario, string> = {
  "photo-socure": "Foto de perfil - Socure",
  "photo-other": "Foto de perfil - outro provedor",
  "photo-unknown": "Foto de perfil - provedor desconhecido",
  "license-socure": "CNH - Socure",
  "license-other": "CNH - outro provedor",
  captcha: "CAPTCHA",
  "2fa": "Autenticação em duas etapas",
  block: "Bloqueio de segurança",
};
