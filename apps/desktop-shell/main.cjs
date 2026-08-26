/**
 * Shell desktop do painel — abre o admin em janela nativa (não no Chrome/Safari).
 *
 * Env:
 *   DESKTOP_PANEL_URL  (padrão: http://localhost:3000)
 *   DESKTOP_WAIT_MS    (padrão: 120000) — tempo máx. esperando o painel subir
 */
const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const https = require("node:https");

const PANEL_URL = (process.env.DESKTOP_PANEL_URL || "http://localhost:3000").replace(/\/$/, "");
const WAIT_MS = Number(process.env.DESKTOP_WAIT_MS || 120_000);

function probe(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: 2500 }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForPanel(url, maxMs) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (await probe(`${url}/login`)) return true;
    if (await probe(url)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function createWindow(ready) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Uber Automation — Painel",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Links externos (docs, Veriff etc.) abrem no navegador do sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(PANEL_URL) && !url.startsWith("about:")) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  if (ready) {
    void win.loadURL(`${PANEL_URL}/login`);
  } else {
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Painel offline</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;
  align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
  h1{font-size:1.25rem;margin:0 0 8px}p{opacity:.8;max-width:420px;line-height:1.5}
  code{background:#1e293b;padding:2px 6px;border-radius:4px}
</style></head><body>
  <div>
    <h1>Painel ainda não está no ar</h1>
    <p>Não foi possível conectar em <code>${PANEL_URL}</code> em ${Math.round(WAIT_MS / 1000)}s.</p>
    <p>Rode o instalador/inicializador (Docker) e abra de novo.</p>
  </div>
</body></html>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }

  return win;
}

app.whenReady().then(async () => {
  const ready = await waitForPanel(PANEL_URL, WAIT_MS);
  createWindow(ready);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(true);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
