# Relatório de precisão - VerificationFlowDetector vs. mock-server (Fase 3)

Gerado executando o detector real contra o HTML real renderizado por `apps/mock-server` (não fixtures escritas à mão) - reflete exatamente o que a automação veria.

**Taxa de acerto: 8/8 (100%)**

## Foto de perfil / CNH (provedor)

| Cenário                         | URL                                | Esperado          | Obtido            | Método         | Domínio             | OK? |
| ------------------------------- | ---------------------------------- | ----------------- | ----------------- | -------------- | ------------------- | --- |
| Foto de perfil - Socure         | `/mock-uber/profile-photo-socure`  | SOCURE / HIGH     | SOCURE / HIGH     | HTML_ATTRIBUTE | socure.com          | ✅  |
| Foto de perfil - outro provedor | `/mock-uber/profile-photo-other`   | NOT_SOCURE / HIGH | NOT_SOCURE / HIGH | HTML_TITLE     | verificador-xyz.com | ✅  |
| Foto de perfil - desconhecido   | `/mock-uber/profile-photo-unknown` | UNKNOWN / LOW     | UNKNOWN / LOW     | HTML_ATTRIBUTE | -                   | ✅  |
| CNH - Socure                    | `/mock-uber/driver-license-socure` | SOCURE / HIGH     | SOCURE / HIGH     | HTML_ATTRIBUTE | socure.com          | ✅  |
| CNH - outro provedor            | `/mock-uber/driver-license-other`  | NOT_SOCURE / HIGH | NOT_SOCURE / HIGH | HTML_TITLE     | verificador-xyz.com | ✅  |

## Páginas de desafio (CAPTCHA / 2FA / bloqueio)

| Cenário               | URL                         | Esperado       | Obtido         | OK? |
| --------------------- | --------------------------- | -------------- | -------------- | --- |
| CAPTCHA               | `/mock-uber/captcha`        | CAPTCHA        | CAPTCHA        | ✅  |
| 2FA                   | `/mock-uber/two-factor`     | TWO_FACTOR     | TWO_FACTOR     | ✅  |
| Bloqueio de segurança | `/mock-uber/security-block` | SECURITY_BLOCK | SECURITY_BLOCK | ✅  |

## Sinais detectados por cenário

### Foto de perfil - Socure (`/mock-uber/profile-photo-socure`)

- Atributo data-provider="socure" encontrado no HTML
- Título da página menciona "Socure": "Verificação de Identidade - Socure · Mock Uber (ambiente de testes)"
- Texto da página menciona "Socure"
- Script carregado referencia Socure: "/fake-sdk/socure.fake.js"

### Foto de perfil - outro provedor (`/mock-uber/profile-photo-other`)

- Atributo data-provider="other" encontrado no HTML (não é Socure)
- Título da página menciona "Verificador XYZ": "Verificação de Identidade - Verificador XYZ · Mock Uber (ambiente de testes)"
- Texto da página menciona "Verificador XYZ"
- Script carregado referencia Verificador XYZ: "/fake-sdk/verificador-xyz.fake.js"

### Foto de perfil - desconhecido (`/mock-uber/profile-photo-unknown`)

- Atributo data-provider="unknown" encontrado no HTML
- Página contém aviso explícito de que o provedor não pôde ser identificado

### CNH - Socure (`/mock-uber/driver-license-socure`)

- Atributo data-provider="socure" encontrado no HTML
- Título da página menciona "Socure": "Verificação de Carteira de Motorista - Socure · Mock Uber (ambiente de testes)"
- Texto da página menciona "Socure"
- Script carregado referencia Socure: "/fake-sdk/socure.fake.js"

### CNH - outro provedor (`/mock-uber/driver-license-other`)

- Atributo data-provider="other" encontrado no HTML (não é Socure)
- Título da página menciona "Verificador XYZ": "Verificação de Carteira - Verificador XYZ · Mock Uber (ambiente de testes)"
- Texto da página menciona "Verificador XYZ"
- Script carregado referencia Verificador XYZ: "/fake-sdk/verificador-xyz.fake.js"

### CAPTCHA (`/mock-uber/captcha`)

- isVerificationPage=false
- isCaptchaPage=true
- isTwoFactorPage=false
- isSecurityBlockPage=false

### 2FA (`/mock-uber/two-factor`)

- isVerificationPage=false
- isCaptchaPage=false
- isTwoFactorPage=true
- isSecurityBlockPage=false

### Bloqueio de segurança (`/mock-uber/security-block`)

- isVerificationPage=false
- isCaptchaPage=false
- isTwoFactorPage=false
- isSecurityBlockPage=true
