import { z } from "zod";

export const createProxySchema = z.object({
  host: z.string().trim().min(1, "host é obrigatório"),
  port: z.coerce.number().int().min(1).max(65535),
  protocol: z.enum(["http", "https", "socks5"]).default("http"),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  declaredRegion: z.string().trim().optional(),
});

export type CreateProxyInput = z.infer<typeof createProxySchema>;
