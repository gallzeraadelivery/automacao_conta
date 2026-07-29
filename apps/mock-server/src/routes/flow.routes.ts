import { Router } from "express";
import { SCENARIO_PATHS } from "../scenarios";
import type { ApplicantFormData } from "../session";
import {
  generateSixDigitCode,
  resolveScenario,
  scenarioQueryString,
  simulateNetworkDelay,
} from "../lib/scenarioContext";

export const flowRouter = Router();

const REQUIRED_APPLICANT_FIELDS: Array<keyof ApplicantFormData> = [
  "fullName",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "postalCode",
  "vehicleType",
];

flowRouter.get("/", (_req, res) => {
  res.redirect("/mock-uber/login");
});

flowRouter.get("/login", (req, res) => {
  const scenario = resolveScenario(req);
  res.render("login", {
    error: null,
    scenario,
    scenarioQuery: scenarioQueryString(scenario),
    scenarioPaths: SCENARIO_PATHS,
  });
});

flowRouter.post("/login", async (req, res) => {
  await simulateNetworkDelay();
  const scenario = resolveScenario(req);
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).render("login", {
      error: "Informe e-mail e senha para continuar.",
      scenario,
      scenarioQuery: scenarioQueryString(scenario),
      scenarioPaths: SCENARIO_PATHS,
    });
  }

  req.session.loggedIn = true;
  req.session.loginEmail = email;
  return res.redirect(`/mock-uber/application${scenarioQueryString(scenario)}`);
});

flowRouter.get("/application", (req, res) => {
  const scenario = resolveScenario(req);
  if (!req.session.loggedIn) {
    return res.redirect(`/mock-uber/login${scenarioQueryString(scenario)}`);
  }
  res.render("application", {
    error: null,
    values: req.session.applicant ?? {},
    scenario,
    scenarioQuery: scenarioQueryString(scenario),
    scenarioPaths: SCENARIO_PATHS,
  });
});

flowRouter.post("/application", async (req, res) => {
  await simulateNetworkDelay();
  const scenario = resolveScenario(req);

  if (!req.session.loggedIn) {
    return res.redirect(`/mock-uber/login${scenarioQueryString(scenario)}`);
  }

  const values = req.body as Partial<ApplicantFormData>;
  const missing = REQUIRED_APPLICANT_FIELDS.filter((field) => !values[field]?.toString().trim());

  if (missing.length > 0) {
    return res.status(400).render("application", {
      error: `Preencha todos os campos obrigatórios (faltando: ${missing.join(", ")}).`,
      values,
      scenario,
      scenarioQuery: scenarioQueryString(scenario),
      scenarioPaths: SCENARIO_PATHS,
    });
  }

  req.session.applicant = values as ApplicantFormData;
  return res.redirect(`/mock-uber/email-verification${scenarioQueryString(scenario)}`);
});

flowRouter.get("/email-verification", (req, res) => {
  const scenario = resolveScenario(req);
  if (!req.session.loggedIn || !req.session.applicant) {
    return res.redirect(`/mock-uber/login${scenarioQueryString(scenario)}`);
  }

  if (!req.session.emailCode) {
    req.session.emailCode = generateSixDigitCode();
  }

  res.render("email-verification", {
    error: null,
    email: req.session.applicant.email,
    code: req.session.emailCode,
    scenario,
    scenarioQuery: scenarioQueryString(scenario),
    scenarioPaths: SCENARIO_PATHS,
  });
});

flowRouter.post("/email-verification", async (req, res) => {
  await simulateNetworkDelay();
  const scenario = resolveScenario(req);

  if (!req.session.loggedIn || !req.session.applicant) {
    return res.redirect(`/mock-uber/login${scenarioQueryString(scenario)}`);
  }

  const { code } = req.body as { code?: string };

  if (!code || code !== req.session.emailCode) {
    return res.status(400).render("email-verification", {
      error: "Código incorreto. Confira o código exibido acima e tente novamente.",
      email: req.session.applicant.email,
      code: req.session.emailCode,
      scenario,
      scenarioQuery: scenarioQueryString(scenario),
      scenarioPaths: SCENARIO_PATHS,
    });
  }

  req.session.emailVerified = true;
  return res.redirect(`/mock-uber/next-step${scenarioQueryString(scenario)}`);
});

flowRouter.get("/next-step", (req, res) => {
  const scenario = resolveScenario(req);
  if (!req.session.loggedIn || !req.session.applicant || !req.session.emailVerified) {
    return res.redirect(`/mock-uber/login${scenarioQueryString(scenario)}`);
  }
  return res.redirect(SCENARIO_PATHS[scenario]);
});
