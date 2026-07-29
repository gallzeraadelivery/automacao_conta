import { Router } from "express";
import { resolveScenario } from "../lib/scenarioContext";

export const scenariosRouter = Router();

interface VerificationStepView {
  title: string;
  stepType: "profile-photo" | "driver-license";
  provider: "socure" | "other" | "unknown";
  providerName: string;
  providerInitials: string;
  instructions: string;
  actions: Array<{ label: string; testid: string }>;
  humanMessage: string;
  fakeScriptSrc: string | null;
  simulatedDomain: string | null;
}

const HUMAN_MESSAGE_KNOWN = "Por favor, complete esta etapa pessoalmente.";
const HUMAN_MESSAGE_UNKNOWN =
  "Provedor não identificado com segurança - esta etapa exige revisão manual antes de prosseguir.";

const PROFILE_PHOTO_SOCURE: VerificationStepView = {
  title: "Verificação de Identidade - Socure",
  stepType: "profile-photo",
  provider: "socure",
  providerName: "Socure",
  providerInitials: "SC",
  instructions: "Para concluir seu cadastro, tire uma selfie ou envie um arquivo pelo app oficial.",
  actions: [
    { label: "Tirar Selfie", testid: "take-selfie-button" },
    { label: "Enviar Arquivo", testid: "upload-file-button" },
  ],
  humanMessage: HUMAN_MESSAGE_KNOWN,
  fakeScriptSrc: "/fake-sdk/socure.fake.js",
  simulatedDomain: "socure.com",
};

const PROFILE_PHOTO_OTHER: VerificationStepView = {
  title: "Verificação de Identidade - Verificador XYZ",
  stepType: "profile-photo",
  provider: "other",
  providerName: "Verificador XYZ",
  providerInitials: "XY",
  instructions: "Para concluir seu cadastro, tire uma selfie pelo app oficial.",
  actions: [{ label: "Tirar Selfie", testid: "take-selfie-button" }],
  humanMessage: HUMAN_MESSAGE_KNOWN,
  fakeScriptSrc: "/fake-sdk/verificador-xyz.fake.js",
  simulatedDomain: "verificador-xyz.com",
};

const PROFILE_PHOTO_UNKNOWN: VerificationStepView = {
  title: "Verificação de Identidade",
  stepType: "profile-photo",
  provider: "unknown",
  providerName: "",
  providerInitials: "",
  instructions: "Etapa de verificação de identidade.",
  actions: [{ label: "Tirar Selfie", testid: "take-selfie-button" }],
  humanMessage: HUMAN_MESSAGE_UNKNOWN,
  fakeScriptSrc: null,
  simulatedDomain: null,
};

const DRIVER_LICENSE_SOCURE: VerificationStepView = {
  title: "Verificação de Carteira de Motorista - Socure",
  stepType: "driver-license",
  provider: "socure",
  providerName: "Socure",
  providerInitials: "SC",
  instructions: "Envie sua Carteira Nacional de Habilitação (CNH) pelo app oficial.",
  actions: [{ label: "Enviar Carteira", testid: "upload-license-button" }],
  humanMessage: HUMAN_MESSAGE_KNOWN,
  fakeScriptSrc: "/fake-sdk/socure.fake.js",
  simulatedDomain: "socure.com",
};

const DRIVER_LICENSE_OTHER: VerificationStepView = {
  title: "Verificação de Carteira - Verificador XYZ",
  stepType: "driver-license",
  provider: "other",
  providerName: "Verificador XYZ",
  providerInitials: "XY",
  instructions: "Envie sua Carteira Nacional de Habilitação (CNH) pelo app oficial.",
  actions: [{ label: "Enviar Carteira", testid: "upload-license-button" }],
  humanMessage: HUMAN_MESSAGE_KNOWN,
  fakeScriptSrc: "/fake-sdk/verificador-xyz.fake.js",
  simulatedDomain: "verificador-xyz.com",
};

scenariosRouter.get("/profile-photo-socure", (req, res) => {
  resolveScenario(req);
  res.render("verification-step", PROFILE_PHOTO_SOCURE);
});

scenariosRouter.get("/profile-photo-other", (req, res) => {
  resolveScenario(req);
  res.render("verification-step", PROFILE_PHOTO_OTHER);
});

scenariosRouter.get("/profile-photo-unknown", (req, res) => {
  resolveScenario(req);
  res.render("verification-step", PROFILE_PHOTO_UNKNOWN);
});

scenariosRouter.get("/driver-license-socure", (req, res) => {
  resolveScenario(req);
  res.render("verification-step", DRIVER_LICENSE_SOCURE);
});

scenariosRouter.get("/driver-license-other", (req, res) => {
  resolveScenario(req);
  res.render("verification-step", DRIVER_LICENSE_OTHER);
});

scenariosRouter.get("/captcha", (req, res) => {
  resolveScenario(req);
  res.render("captcha");
});

scenariosRouter.get("/two-factor", (req, res) => {
  resolveScenario(req);
  res.render("two-factor");
});

scenariosRouter.get("/security-block", (req, res) => {
  resolveScenario(req);
  res.render("security-block");
});

/**
 * Endpoint apenas para testes (nao faz parte da simulacao de UX): expoe o
 * estado atual da sessao para scripts de automacao/QA lerem sem precisar de
 * um provedor de e-mail real.
 */
scenariosRouter.get("/__test__/state", (req, res) => {
  res.json({
    loggedIn: Boolean(req.session.loggedIn),
    loginEmail: req.session.loginEmail ?? null,
    applicant: req.session.applicant ?? null,
    emailCode: req.session.emailCode ?? null,
    emailVerified: Boolean(req.session.emailVerified),
    scenario: req.session.scenario ?? null,
  });
});
