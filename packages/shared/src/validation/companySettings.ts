import { z } from "zod";

const phoneBaseSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((value) => value.length === 10, {
    message: "Base do telefone deve ter exatamente 10 dígitos (NANP)",
  });

export const updateCompanySettingsSchema = z.object({
  placeholderPhoneBase: phoneBaseSchema,
  earnCity: z
    .string()
    .trim()
    .min(2, "Informe a cidade Earn")
    .max(100, "Cidade Earn muito longa"),
});

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;
