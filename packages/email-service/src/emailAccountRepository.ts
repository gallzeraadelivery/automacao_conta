export interface EmailAccountCredentialRecord {
  id: string;
  emailAddress: string;
  encryptedPassword: string;
  encryptionIv: string;
  encryptionAuthTag: string;
  provider: string;
}

export interface EmailAccountRepository {
  getById(emailAccountId: string): Promise<EmailAccountCredentialRecord | null>;
  markRequiresHumanAction(emailAccountId: string, reason: string): Promise<void>;
  recordLoginResult(emailAccountId: string, status: string): Promise<void>;
}
