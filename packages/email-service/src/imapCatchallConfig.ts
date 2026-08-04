/**
 * Domínios cujo e-mail Uber chega numa única caixa IMAP (catch-all /
 * forward), não na caixa do endereço usado no signup.
 *
 * Ex.: gallsuper10@mail2too.com → OTP cai em galldelivery@mail2too.com.
 * O signup ainda usa o e-mail do motorista; só a autenticação IMAP muda.
 */
export const IMAP_CATCHALL_INBOX_BY_DOMAIN: Readonly<Record<string, string>> = {
  "mail2too.com": "galldelivery@mail2too.com",
};

/**
 * Se o endereço do motorista pertence a um domínio catch-all e NÃO é a
 * própria caixa inbox, devolve o e-mail da caixa onde o IMAP deve logar.
 * Caso contrário null (usa a conta do próprio motorista).
 */
export function resolveCatchallInboxEmail(emailAddress: string): string | null {
  const normalized = emailAddress.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 0) return null;
  const domain = normalized.slice(at + 1);
  const inbox = IMAP_CATCHALL_INBOX_BY_DOMAIN[domain];
  if (!inbox) return null;
  if (normalized === inbox.toLowerCase()) return null;
  return inbox.toLowerCase();
}
