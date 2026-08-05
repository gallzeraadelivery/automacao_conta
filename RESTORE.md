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

## ATUAL — Electron mobile Android (2026-08-05)

**Use este** se quiser o stack com Electron + Android + caminho Menu→Deliver + humanize + fingerprints.

| Item | Valor |
|------|--------|
| **Nome legível** | Electron Android signup |
| **Tag** | `restore/electron-android-2026-08-05` |
| **Branch de backup** | `backup/electron-android-2026-08-05` |
| **Commit** | `6db2113` |
| **Branch principal** | `claude/sistema-6-fases-iuzzhr` |
| **Data** | 2026-08-05 |

### O que inclui (resumo)

- Browser: `AUTOMATION_BROWSER_ENGINE=electron` (`apps/mobile-shell`)
- Signup só Android (Pixel 7/8, S23, Pixel 6a) + rotação de fingerprint
- Caminho: cookies → Menu/Earn ou Deliver → CTA → `drivers.uber.com` / auth
- Humanize (`humanize.ts`), stealth, stop/stop-all, start em lote

### Como inspecionar / rodar este ponto

```bash
git fetch origin --tags
git checkout backup/electron-android-2026-08-05
# ou só olhar o commit:
git show restore/electron-android-2026-08-05 --stat
```

### Como voltar a branch principal para este ponto

```bash
git fetch origin --tags
git checkout claude/sistema-6-fases-iuzzhr
git reset --hard restore/electron-android-2026-08-05
# só se quiser publicar o reset (CUIDADO):
# git push --force-with-lease origin claude/sistema-6-fases-iuzzhr
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
| Stack Electron + Android de agora | `restore/electron-android-2026-08-05` / `backup/electron-android-2026-08-05` |
| Última versão estável pré-Electron (Socure) | `restore/socure-stable-2026-08-04` / `backup/socure-stable-2026-08-04` |
| Lista de todos os restores | `git tag -l 'restore/*'` |

`--force-with-lease` só sobrescreve o remote se ninguém tiver empurrado commits novos sem você saber. Confirme antes de forçar push em produção compartilhada.
