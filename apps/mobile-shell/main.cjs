/**
 * Shell Electron mobile — janela tamanho smartphone + UA + proxy + CDP.
 * O worker conecta via Playwright chromium.connectOverCDP.
 *
 * Env:
 *   MOBILE_SHELL_CONFIG = JSON {
 *     cdpPort, userAgent, width, height, deviceScaleFactor,
 *     userDataDir?: string,  // isolado por motorista (obrigatório em produção)
 *     proxy?: { server, username?, password? }
 *   }
 */
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function readConfig() {
  const raw = process.env.MOBILE_SHELL_CONFIG || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const config = readConfig();
const cdpPort = Number(config.cdpPort || 9333);
const width = Math.max(320, Number(config.width || 412));
const height = Math.max(568, Number(config.height || 915));
const userAgent =
  config.userAgent ||
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

// Isola cookies/localStorage por perfil — sem isso todos os jobs compartilham
// ~/.config/Electron e “herdam” a sessão Uber do motorista anterior.
if (config.userDataDir && typeof config.userDataDir === "string") {
  try {
    fs.mkdirSync(config.userDataDir, { recursive: true });
    app.setPath("userData", config.userDataDir);
    app.setPath("sessionData", path.join(config.userDataDir, "session"));
  } catch (err) {
    console.error("MOBILE_SHELL_USER_DATA_DIR_FAILED", err);
  }
}
// Docker / container: sem sandbox.
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-setuid-sandbox");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("remote-debugging-port", String(cdpPort));
app.commandLine.appendSwitch("remote-allow-origins", "*");

// Reduz sinais óbvios de automação no Chromium embutido.
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

if (config.proxy?.username || config.proxy?.password) {
  app.on("login", (event, _webContents, _request, _authInfo, callback) => {
    event.preventDefault();
    callback(config.proxy.username || "", config.proxy.password || "");
  });
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  if (userAgent) {
    ses.setUserAgent(userAgent);
  }

  if (config.proxy?.server) {
    // Playwright: "http://host:port" | Electron proxyRules: "host:port" ou scheme://
    let rules = String(config.proxy.server);
    await ses.setProxy({ proxyRules: rules, proxyBypassRules: "<local>" });
  }

  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Mobile: sem plugins; touch via CDP/emulation no Playwright.
      spellcheck: false,
    },
  });

  // about:blank — o worker navega depois via CDP.
  await win.loadURL("about:blank");

  const readyPath = process.env.MOBILE_SHELL_READY_FILE;
  const payload = JSON.stringify({
    ready: true,
    cdpPort,
    pid: process.pid,
    userAgent,
    width,
    height,
  });
  if (readyPath) {
    try {
      fs.writeFileSync(readyPath, payload, "utf8");
    } catch (err) {
      console.error("MOBILE_SHELL_READY_WRITE_FAILED", err);
    }
  }
  // Sempre no stdout (worker faz parse).
  console.log(`MOBILE_SHELL_READY ${payload}`);
});

app.on("window-all-closed", () => {
  app.quit();
});
