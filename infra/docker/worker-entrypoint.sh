#!/bin/sh
set -e

export DISPLAY="${DISPLAY:-:99}"
X_NUM="${DISPLAY#:}"
X_LOCK="/tmp/.X${X_NUM}-lock"

# Socket dir do X11 (Xvfb falha se euid!=0 e a pasta não existe).
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

xvfb_alive() {
  # Lock sozinho não basta — processo pode ter morrido e deixado o arquivo.
  if [ ! -e "$X_LOCK" ]; then
    return 1
  fi
  if command -v xset >/dev/null 2>&1; then
    xset -display "$DISPLAY" q >/dev/null 2>&1 && return 0
    return 1
  fi
  # Fallback: há processo Xvfb escutando este display?
  pgrep -a Xvfb 2>/dev/null | grep -q "Xvfb ${DISPLAY}\|Xvfb :${X_NUM}" && return 0
  return 1
}

start_xvfb() {
  rm -f "$X_LOCK" "/tmp/.X${X_NUM}-lock" 2>/dev/null || true
  # Limpa sockets órfãos deste display.
  rm -f "/tmp/.X11-unix/X${X_NUM}" 2>/dev/null || true
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac -nolisten tcp >/tmp/xvfb.log 2>&1 &
  i=0
  while [ "$i" -lt 80 ]; do
    if xvfb_alive; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.1
  done
  echo "WARN: Xvfb não confirmou display $DISPLAY — ver /tmp/xvfb.log" >&2
  cat /tmp/xvfb.log >&2 || true
  return 1
}

if ! xvfb_alive; then
  start_xvfb || true
fi

# Espelha o DISPLAY virtual no browser do Mac (noVNC → :6080).
if command -v x11vnc >/dev/null 2>&1; then
  # Mata x11vnc zumbi / morto e sobe de novo se preciso.
  if ! pgrep -x x11vnc >/dev/null 2>&1; then
    # Remove zumbis defunct listados por pgrep -a às vezes.
    pkill -x x11vnc 2>/dev/null || true
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
