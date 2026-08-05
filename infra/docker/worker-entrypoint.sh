#!/bin/sh
set -e

export DISPLAY="${DISPLAY:-:99}"

# Sobe Xvfb se ainda não houver display (headed sem HeadlessChrome).
if ! [ -e "/tmp/.X${DISPLAY#:}-lock" ]; then
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac -nolisten tcp >/tmp/xvfb.log 2>&1 &
  # Espera o lock do X aparecer.
  i=0
  while [ "$i" -lt 50 ]; do
    [ -e "/tmp/.X${DISPLAY#:}-lock" ] && break
    i=$((i + 1))
    sleep 0.1
  done
fi

exec pnpm --filter @uber-automation/worker start
