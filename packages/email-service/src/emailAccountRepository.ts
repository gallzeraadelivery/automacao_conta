export interface EmailAccountCredentialRecord {
  id: string;
  companyId: string;
  applicantId: string;
  emailAddress: string;
  encryptedPassword: string;
  encryptionIv: string;
  encryptionAuthTag: string;
  provider: string;
}

export interface EmailAccountRepository {
  getById(emailAccountId: string): Promise<EmailAccountCredentialRecord | null>;
  /** Busca por e-mail dentro da empresa (ex: caixa catch-all compartilhada). */
  getByCompanyAndEmail(
    companyId: string,
    emailAddress: string,
  ): Promise<EmailAccountCredentialRecord | null>;
  markRequiresHumanAction(emailAccountId: string, reason: string): Promise<void>;
  recordLoginResult(emailAccountId: string, status: string): Promise<void>;
}
