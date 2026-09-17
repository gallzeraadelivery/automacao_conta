#!/bin/sh
# Instala Chromium do Playwright (versao do lockfile) com retry.
# Usado pelos Dockerfiles api/worker — POSIX sh (dash), sem bashismos.
set -eu

PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/app/.playwright-browsers}"
export PLAYWRIGHT_BROWSERS_PATH

FILTER="${1:-@uber-automation/proxy-manager}"

find_cli() {
  find /app/node_modules -type f -name cli.js 2>/dev/null | grep '/playwright/cli.js$' | head -1
}

install_once() {
  if pnpm --filter "$FILTER" exec playwright install --with-deps chromium; then
    return 0
  fi
  PW_CLI="$(find_cli)"
  if [ -n "$PW_CLI" ]; then
    echo "fallback: node $PW_CLI install --with-deps chromium"
    node "$PW_CLI" install --with-deps chromium
    return $?
  fi
  echo "playwright cli nao encontrado no node_modules"
  return 1
}

browsers_ok() {
  find "$PLAYWRIGHT_BROWSERS_PATH" -type f \( -name headless_shell -o -name chrome -o -name chromium \) 2>/dev/null | grep -q .
}

i=1
while [ "$i" -le 3 ]; do
  echo "==> playwright install chromium (tentativa $i/3) filter=$FILTER"
  if install_once; then
    break
  fi
  i=$((i + 1))
  if [ "$i" -le 3 ]; then
    sleep 15
  fi
done

if ! browsers_ok; then
  echo "ERRO: Chromium do Playwright nao instalado em $PLAYWRIGHT_BROWSERS_PATH"
  ls -la "$PLAYWRIGHT_BROWSERS_PATH" 2>/dev/null || true
  find_cli || true
  exit 1
fi

echo "==> Playwright chromium OK"

# Opcional: chrome channel (worker). Falha silenciosa em arch sem chrome.
if [ "${2:-}" = "also-chrome" ]; then
  pnpm --filter "$FILTER" exec playwright install --with-deps chrome \
    || echo "WARN: canal chrome indisponivel nesta arch — runtime usa chromium"
fi
