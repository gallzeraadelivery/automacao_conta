import { CredentialVault } from "@uber-automation/credential-vault";
import { auditLogger } from "./auditLogger";

/**
 * O ICredentialVault audita cada acesso (encrypt/decrypt) vinculado à
 * empresa que o solicitou - por isso uma instância é criada por requisição
 * (não é cara: só guarda uma referência de config, a chave mestra tem seu
 * próprio cache interno no MasterKeyProvider).
 */
export function createCredentialVault(companyId: string): CredentialVault {
  return new CredentialVault({ companyId, auditLogger });
}
