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

# Espelha o DISPLAY virtual no browser do Mac (noVNC → :6080).
if command -v x11vnc >/dev/null 2>&1; then
  if ! pgrep -x x11vnc >/dev/null 2>&1; then
    x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -nopw -listen 0.0.0.0 \
      >/tmp/x11vnc.log 2>&1 &
  fi
  if command -v websockify >/dev/null 2>&1 && ! pgrep -f "websockify.*6080" >/dev/null 2>&1; then
    NOVNC_WEB="${NOVNC_WEB:-/usr/share/novnc}"
    websockify --web="$NOVNC_WEB" 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
  fi
fi

# Remove o userData compartilhado legado (vazava sessão Uber entre motoristas).
rm -rf /app/.config/Electron /home/workeruser/.config/Electron 2>/dev/null || true

exec pnpm --filter @uber-automation/worker start
