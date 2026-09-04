# Pontos de restauração (como achar de novo)

Arquivo canônico: **`RESTORE.md` na raiz do repo**.  
Sempre que precisar voltar, comece por aqui:

```bash
cd /caminho/para/uber-automation
cat RESTORE.md
git fetch automacao_conta --tags
git tag -l 'restore/*'
git branch -a | grep backup/
```

---

## ATUAL — Sistema estável / versão principal (2026-09-04)

**Use este** se quiser o estado validado em produção: instaladores Windows/Mac, containers Docker, login admin, licença e IMAP Spacemail.

| Item | Valor |
|------|--------|
| **Nome legível** | Sistema estável (versão principal) |
| **Tag** | `restore/sistema-estavel-2026-09-04` |
| **Branch de backup** | `backup/sistema-estavel-2026-09-04` |
| **Commit da feature** | tip da tag (`git rev-parse restore/sistema-estavel-2026-09-04`) |
| **Branch principal** | `main` |
| **Data** | 2026-09-04 |

### O que inclui (resumo)

- Tudo dos restores anteriores (fluxo Veriff/Socure, Electron, OTP/SMS hardening)
- Instaladores Windows/Mac: Docker, Node, pnpm, Git; containers sobem com verificação
- Seed/admin estável: `admin@example.com` / `admin123` (via container + `RESET-Admin-Windows.bat`)
- Licença GD (`/licenca`) — domínio: **automacao.gdapps.online**
- IMAP Spacemail: `mail.spacemail.com:993`

### Como inspecionar / rodar este ponto

```bash
git fetch automacao_conta --tags
git checkout backup/sistema-estavel-2026-09-04
# ou só olhar o commit:
git show restore/sistema-estavel-2026-09-04 --stat
```

### Como voltar a branch principal para este ponto

```bash
git fetch automacao_conta --tags
git checkout main
git reset --hard restore/sistema-estavel-2026-09-04
# só se quiser publicar o reset (CUIDADO):
# git push --force-with-lease automacao_conta main
```

---

## ANTERIOR — Phone OTP hardening (2026-08-06)

Estado pós-lote Veriff com endurecimento de OTP/SMS, base de telefone nova e relatório Socure.

| Item | Valor |
|------|--------|
| **Nome legível** | Phone OTP hardening |
| **Tag** | `restore/phone-otp-hardening-2026-08-06` |
| **Branch de backup** | `backup/phone-otp-hardening-2026-08-06` |
| **Branch principal (na época)** | `claude/sistema-6-fases-iuzzhr` |
| **Data** | 2026-08-06 |

```bash
git fetch automacao_conta --tags
git checkout backup/phone-otp-hardening-2026-08-06
git show restore/phone-otp-hardening-2026-08-06 --stat
```

---

## ANTERIOR — Fluxo completo Veriff/Socure (2026-08-06)

Signup Delivery do zero até Driver requirements + probe; cookies AdsPower; sessão Electron isolada.

| Item | Valor |
|------|--------|
| **Tag** | `restore/fluxo-completo-veriff-2026-08-06` |
| **Branch de backup** | `backup/fluxo-completo-veriff-2026-08-06` |
| **Data** | 2026-08-06 |

```bash
git fetch automacao_conta --tags
git checkout backup/fluxo-completo-veriff-2026-08-06
git show restore/fluxo-completo-veriff-2026-08-06 --stat
```

---

## ANTERIOR — Electron mobile Android (2026-08-05)

| Item | Valor |
|------|--------|
| **Tag** | `restore/electron-android-2026-08-05` |
| **Branch de backup** | `backup/electron-android-2026-08-05` |
| **Data** | 2026-08-05 |

```bash
git fetch automacao_conta --tags
git checkout backup/electron-android-2026-08-05
git show restore/electron-android-2026-08-05 --stat
```

---

## ANTERIOR — Socure estável (2026-08-04)

Versão **antes** do Electron. Fluxo até probe Socure/Veriff + descarte `REFUSED`.

| Item | Valor |
|------|--------|
| **Tag** | `restore/socure-stable-2026-08-04` |
| **Branch de backup** | `backup/socure-stable-2026-08-04` |
| **Commit** | `f3b1b38` |

```bash
git fetch automacao_conta --tags
git checkout backup/socure-stable-2026-08-04
git show restore/socure-stable-2026-08-04
```

---

## Atalho mental

| Quero… | Tag / branch |
|--------|----------------|
| **Sistema estável (agora / principal)** | `restore/sistema-estavel-2026-09-04` / `backup/sistema-estavel-2026-09-04` / `main` |
| Phone OTP hardening | `restore/phone-otp-hardening-2026-08-06` / `backup/phone-otp-hardening-2026-08-06` |
| Fluxo completo Veriff (lote 25/25) | `restore/fluxo-completo-veriff-2026-08-06` / `backup/fluxo-completo-veriff-2026-08-06` |
| Stack Electron + Android (2026-08-05) | `restore/electron-android-2026-08-05` / `backup/electron-android-2026-08-05` |
| Última versão estável pré-Electron (Socure) | `restore/socure-stable-2026-08-04` / `backup/socure-stable-2026-08-04` |
| Lista de todos os restores | `git tag -l 'restore/*'` |

`--force-with-lease` só sobrescreve o remote se ninguém tiver empurrado commits novos sem você saber. Confirme antes de forçar push em produção compartilhada.
