/**
 * Mascara um codigo de verificacao para logs/auditoria. Ex: "482913" -> "****13".
 * Nunca deve ser usado para decidir logica de negocio - apenas para exibicao.
 */
export function maskCode(code: string): string {
  if (!code) return "****";
  const visible = code.slice(-2);
  return `****${visible}`;
}

/**
 * Mascara um e-mail para logs/auditoria. Ex: "joao.silva@gmail.com" -> "j***@gmail.com".
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***";
  const domain = email.slice(atIndex + 1);
  return `${email[0]}***@${domain}`;
}

/**
 * Mascara um telefone para logs/auditoria. Ex: "11999998888" -> "****8888".
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `****${digits.slice(-4)}`;
}
