import session from "express-session";
import type { Scenario } from "./scenarios";

export interface ApplicantFormData {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  vehicleType: string;
}

declare module "express-session" {
  interface SessionData {
    loggedIn?: boolean;
    loginEmail?: string;
    applicant?: ApplicantFormData;
    emailCode?: string;
    emailVerified?: boolean;
    scenario?: Scenario;
  }
}

export function createSessionMiddleware(secret: string) {
  return session({
    name: "mock_uber_sid",
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  });
}
