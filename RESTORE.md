# Pontos de restauração (como achar de novo)

Arquivo canônico: **`RESTORE.md` na raiz do repo**.  
Sempre que precisar voltar, comece por aqui:

```bash
cd /caminho/para/uber-automation
cat RESTORE.md
git fetch origin --tags
git tag -l 'restore/*'
git branch -a | grep backup/
```

---

## ATUAL — Phone OTP hardening (2026-08-06)

**Use este** se quiser o estado pós-lote Veriff com endurecimento de OTP/SMS, base de telefone nova e relatório Socure.

| Item | Valor |
|------|--------|
| **Nome legível** | Phone OTP hardening |
| **Tag** | `restore/phone-otp-hardening-2026-08-06` |
| **Branch de backup** | `backup/phone-otp-hardening-2026-08-06` |
| **Commit da feature** | tip da tag (`git rev-parse restore/phone-otp-hardening-2026-08-06`) |
| **Branch principal** | `claude/sistema-6-fases-iuzzhr` |
| **Data** | 2026-08-06 |

### O que inclui (resumo)

- Tudo do restore Veriff anterior (Electron isolado, Welcome back, cookies AdsPower, lote 25/25)
- Extrator IMAP: confiança mínima **MEDIUM** (ignora LOW do catch-all)
- SMS: até 2 placeholders → `PHONE_PROBLEM` (FAILED, tenta depois); blacklist de números
- Base placeholder: `5613265300` → `(561) 326-5300`…
- Xvfb: entrypoint valida display vivo / limpa lock morto
- Relatório BI Socure (`/dashboard/reports/socure`) + download cookies

### Como inspecionar / rodar este ponto

```bash
git fetch origin --tags
git checkout backup/phone-otp-hardening-2026-08-06
# ou só olhar o commit:
git show restore/phone-otp-hardening-2026-08-06 --stat
```

### Como voltar a branch principal para este ponto

```bash
git fetch origin --tags
git checkout claude/sistema-6-fases-iuzzhr
git reset --hard restore/phone-otp-hardening-2026-08-06
# só se quiser publicar o reset (CUIDADO):
# git push --force-with-lease origin claude/sistema-6-fases-iuzzhr
```

---

## ANTERIOR — Fluxo completo Veriff/Socure (2026-08-06)

Signup Delivery do zero até Driver requirements + probe; cookies AdsPower; sessão Electron isolada. **Antes** do endurecimento OTP/SMS e da base `326-5300`.

| Item | Valor |
|------|--------|
| **Nome legível** | Fluxo completo Veriff/Socure |
| **Tag** | `restore/fluxo-completo-veriff-2026-08-06` |
| **Branch de backup** | `backup/fluxo-completo-veriff-2026-08-06` |
| **Commit da feature** | tip da tag (`git rev-parse restore/fluxo-completo-veriff-2026-08-06`) |
| **Branch principal** | `claude/sistema-6-fases-iuzzhr` |
| **Data** | 2026-08-06 |

```bash
git fetch origin --tags
git checkout backup/fluxo-completo-veriff-2026-08-06
git show restore/fluxo-completo-veriff-2026-08-06 --stat
```

---

## ANTERIOR — Electron mobile Android (2026-08-05)

Stack Electron + Android + Menu→Deliver + humanize — **antes** do isolamento de sessão / Welcome back / volume de cookies na API.

| Item | Valor |
|------|--------|
| **Nome legível** | Electron Android signup |
| **Tag** | `restore/electron-android-2026-08-05` |
| **Branch de backup** | `backup/electron-android-2026-08-05` |
| **Commit da feature** | `6db2113` — tip da tag (`git rev-parse restore/electron-android-2026-08-05`) |
| **Branch principal** | `claude/sistema-6-fases-iuzzhr` |
| **Data** | 2026-08-05 |

```bash
git fetch origin --tags
git checkout backup/electron-android-2026-08-05
git show restore/electron-android-2026-08-05 --stat
```

---

## ANTERIOR — Socure estável (2026-08-04)

Versão **antes** do Electron. Fluxo até probe Socure/Veriff + descarte `REFUSED`.

| Item | Valor |
|------|--------|
| **Nome legível** | Socure estável |
| **Tag** | `restore/socure-stable-2026-08-04` |
| **Branch de backup** | `backup/socure-stable-2026-08-04` |
| **Commit** | `f3b1b38` |
| **Branch principal** | `claude/sistema-6-fases-iuzzhr` |

```bash
git fetch origin --tags
git checkout backup/socure-stable-2026-08-04
# ou:
git show restore/socure-stable-2026-08-04
```

Reset da principal para o Socure:

```bash
git checkout claude/sistema-6-fases-iuzzhr
git reset --hard restore/socure-stable-2026-08-04
# git push --force-with-lease origin claude/sistema-6-fases-iuzzhr
```

---

## Atalho mental

| Quero… | Tag / branch |
|--------|----------------|
| Phone OTP hardening (agora) | `restore/phone-otp-hardening-2026-08-06` / `backup/phone-otp-hardening-2026-08-06` |
| Fluxo completo Veriff (lote 25/25) | `restore/fluxo-completo-veriff-2026-08-06` / `backup/fluxo-completo-veriff-2026-08-06` |
| Stack Electron + Android (2026-08-05) | `restore/electron-android-2026-08-05` / `backup/electron-android-2026-08-05` |
| Última versão estável pré-Electron (Socure) | `restore/socure-stable-2026-08-04` / `backup/socure-stable-2026-08-04` |
| Lista de todos os restores | `git tag -l 'restore/*'` |

`--force-with-lease` só sobrescreve o remote se ninguém tiver empurrado commits novos sem você saber. Confirme antes de forçar push em produção compartilhada.
