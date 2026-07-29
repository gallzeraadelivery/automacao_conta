import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "email é obrigatório").email("email inválido"),
  password: z.string().min(1, "password é obrigatório"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken é obrigatório"),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
