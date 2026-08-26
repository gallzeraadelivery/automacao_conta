import { z } from "zod";

const phoneBaseSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((value) => value.length === 10, {
    message: "Base do telefone deve ter exatamente 10 dígitos (NANP)",
  });

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Informe o domínio de e-mail")
  .max(255)
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Domínio inválido (ex.: mailsproton.com)");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("E-mail do catch-all inválido")
  .max(255);

const providerSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9_-]+$/i, "Provider inválido (ex.: spacemail, gmail)");

const domainsCsvSchema = z
  .string()
  .trim()
  .min(3, "Informe ao menos um domínio catch-all")
  .max(1000)
  .transform((value) =>
    value
      .split(/[,;\s]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
      .join(","),
  )
  .refine((value) => value.split(",").every((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)), {
    message: "Lista de domínios inválida (ex.: mailsproton.com,mail2too.com)",
  });

export const updateCompanySettingsSchema = z.object({
  placeholderPhoneBase: phoneBaseSchema,
  earnCity: z
    .string()
    .trim()
    .min(2, "Informe a cidade Earn")
    .max(100, "Cidade Earn muito longa"),
  signupEmailDomain: domainSchema,
  signupEmailProvider: providerSchema,
  catchallInboxEmail: emailSchema,
  catchallDomains: domainsCsvSchema,
  /** Opcional: se omitido/vazio, mantém a senha já cadastrada da caixa catch-all. */
  catchallPassword: z.union([z.string().min(1).max(200), z.literal("")]).optional(),
});

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;
