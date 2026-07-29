/**
 * Automacao de navegador (Playwright) para preenchimento administrativo do
 * cadastro do motorista - implementada nas proximas fases.
 *
 * Regras invariaveis para toda a logica adicionada aqui:
 * - Preenche apenas dados administrativos (nome, email, telefone, endereco, CEP, tipo de veiculo).
 * - Ao encontrar qualquer etapa sensivel (foto de perfil, CNH, verificacao facial,
 *   prova de vida, CAPTCHA, 2FA), a automacao PARA IMEDIATAMENTE, registra o provedor
 *   detectado e entrega a sessao para o motorista concluir pessoalmente.
 * - Nunca resolve CAPTCHA, nunca faz prova de vida, nunca acessa camera,
 *   nunca altera o provedor de verificacao escolhido pela plataforma.
 */
export const AUTOMATION_PACKAGE_PLACEHOLDER = true;
