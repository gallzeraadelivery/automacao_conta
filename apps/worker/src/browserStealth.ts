import type { BrowserContext, LaunchOptions } from "playwright";
import type { BrowserFingerprint } from "./browserFingerprint";
import { fingerprintInitPayload } from "./browserFingerprint";

/**
 * Args de launch que reduzem sinais óbvios de automação no Chromium.
 */
export const STEALTH_LAUNCH_ARGS: string[] = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-infobars",
  // WebRTC: evita vazamento fácil de IP local (complementa patch JS "replace").
  "--enforce-webrtc-ip-permission-check",
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
];

export const STEALTH_IGNORE_DEFAULT_ARGS: string[] = ["--enable-automation"];

export function stealthLaunchOptions(
  base: Pick<LaunchOptions, "headless" | "executablePath" | "channel">,
): LaunchOptions {
  const { headless, executablePath, channel } = base;
  // executablePath e channel são mutuamente exclusivos no Playwright.
  return {
    headless,
    ...(executablePath ? { executablePath } : channel ? { channel } : {}),
    args: [
      ...STEALTH_LAUNCH_ARGS,
      // Em headed/xvfb, reduz prompts e melhora estabilidade em container.
      "--window-size=1920,1080",
    ],
    ignoreDefaultArgs: STEALTH_IGNORE_DEFAULT_ARGS,
  };
}

export interface StealthContextOptions {
  locale: string;
  languages?: string[];
  /** Perfil completo — se omitido, só stealth básico. */
  fingerprint?: BrowserFingerprint;
}

/**
 * Stealth básico + (opcional) pacote AdsPower-like do fingerprint.
 */
export async function applyStealthToContext(
  context: BrowserContext,
  options: StealthContextOptions,
): Promise<void> {
  if (options.fingerprint) {
    await applyFingerprintProfile(context, options.fingerprint);
    return;
  }

  const languages =
    options.languages ??
    (options.locale.toLowerCase().startsWith("en")
      ? [options.locale, "en"]
      : [options.locale, "en-US", "en"]);

  await context.addInitScript(basicStealthInit, { languages });
}

/** Aplica o pacote inteiro (UA já vai no newContext; aqui é o que a página lê via JS). */
export async function applyFingerprintProfile(
  context: BrowserContext,
  fingerprint: BrowserFingerprint,
): Promise<void> {
  const payload = fingerprintInitPayload(fingerprint);
  await context.addInitScript(fingerprintProfileInit, payload);
}

function basicStealthInit(data: { languages: string[] }): void {
  const langs = data.languages;
  try {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => undefined,
      configurable: true,
    });
  } catch {
    /* ignore */
  }
  try {
    const w = window as unknown as { chrome?: { runtime?: object } };
    if (!w.chrome) w.chrome = { runtime: {} };
  } catch {
    /* ignore */
  }
  try {
    Object.defineProperty(Navigator.prototype, "languages", {
      get: () => Object.freeze([...langs]),
      configurable: true,
    });
    Object.defineProperty(Navigator.prototype, "language", {
      get: () => langs[0] ?? "en-US",
      configurable: true,
    });
  } catch {
    /* ignore */
  }
}

/**
 * Roda no browser antes de qualquer script da página.
 * Payload = fingerprintInitPayload(fp).
 */
function fingerprintProfileInit(raw: Record<string, unknown>): void {
  const p = raw as {
    hardwareConcurrency: number;
    deviceMemory: number;
    deviceName: string;
    macAddress: string;
    webglVendor: string;
    webglRenderer: string;
    audioNoiseSeed: string;
    canvasMode: "real" | "noise";
    webglImageMode: "real" | "noise";
    webrtcMode: "replace" | "disabled" | "real";
    platform: string;
    maxTouchPoints: number;
    languages: string[];
    screenWidth: number;
    screenHeight: number;
    deviceScaleFactor: number;
  };

  const seedInt = (() => {
    let h = 0;
    for (let i = 0; i < p.audioNoiseSeed.length; i++) {
      h = (Math.imul(31, h) + p.audioNoiseSeed.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  })();

  const seeded = (n: number) => {
    const x = Math.sin(seedInt * 9999 + n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  try {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => undefined,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  try {
    const w = window as unknown as { chrome?: { runtime?: object }; __uaDeviceName?: string };
    if (!w.chrome) w.chrome = { runtime: {} };
    w.__uaDeviceName = p.deviceName;
  } catch {
    /* ignore */
  }

  try {
    Object.defineProperty(Navigator.prototype, "languages", {
      get: () => Object.freeze([...p.languages]),
      configurable: true,
    });
    Object.defineProperty(Navigator.prototype, "language", {
      get: () => p.languages[0] ?? "en-US",
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  try {
    Object.defineProperty(Navigator.prototype, "platform", {
      get: () => p.platform,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  try {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
      get: () => p.hardwareConcurrency,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  try {
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      get: () => p.deviceMemory,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  try {
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
      get: () => p.maxTouchPoints,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  try {
    Object.defineProperty(Navigator.prototype, "plugins", {
      get: () =>
        [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
          { name: "Native Client", filename: "internal-nacl-plugin" },
        ] as unknown as PluginArray,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  // screen coerente com viewport
  try {
    Object.defineProperty(window.screen, "width", { get: () => p.screenWidth, configurable: true });
    Object.defineProperty(window.screen, "height", { get: () => p.screenHeight, configurable: true });
    Object.defineProperty(window.screen, "availWidth", {
      get: () => p.screenWidth,
      configurable: true,
    });
    Object.defineProperty(window.screen, "availHeight", {
      get: () => p.screenHeight - 40,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  // WebGL vendor/renderer
  try {
    const proto = WebGLRenderingContext.prototype;
    const originalGetParameter = proto.getParameter;
    proto.getParameter = function (parameter: number) {
      const UNMASKED_VENDOR_WEBGL = 0x9245;
      const UNMASKED_RENDERER_WEBGL = 0x9246;
      if (parameter === UNMASKED_VENDOR_WEBGL) return p.webglVendor;
      if (parameter === UNMASKED_RENDERER_WEBGL) return p.webglRenderer;
      return originalGetParameter.call(this, parameter);
    };
  } catch {
    /* ignore */
  }

  try {
    const proto2 = (window as unknown as { WebGL2RenderingContext?: { prototype: WebGLRenderingContext } })
      .WebGL2RenderingContext?.prototype;
    if (proto2) {
      const originalGetParameter2 = proto2.getParameter;
      proto2.getParameter = function (parameter: number) {
        const UNMASKED_VENDOR_WEBGL = 0x9245;
        const UNMASKED_RENDERER_WEBGL = 0x9246;
        if (parameter === UNMASKED_VENDOR_WEBGL) return p.webglVendor;
        if (parameter === UNMASKED_RENDERER_WEBGL) return p.webglRenderer;
        return originalGetParameter2.call(this, parameter);
      };
    }
  } catch {
    /* ignore */
  }

  // Canvas noise
  if (p.canvasMode === "noise") {
    try {
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...args: unknown[]) {
        try {
          const ctx = this.getContext("2d");
          if (ctx && this.width > 0 && this.height > 0) {
            const x = Math.floor(seeded(1) * this.width);
            const y = Math.floor(seeded(2) * this.height);
            const img = ctx.getImageData(x, y, 1, 1);
            img.data[0] = (img.data[0]! + (seedInt % 3)) % 256;
            ctx.putImageData(img, x, y);
          }
        } catch {
          /* ignore */
        }
        return toDataURL.apply(this, args as []);
      };
    } catch {
      /* ignore */
    }
  }

  // AudioContext noise (AnalyserNode)
  if (p.audioNoiseSeed) {
    try {
      const Analyser = window.AnalyserNode;
      if (Analyser) {
        const original = Analyser.prototype.getFloatFrequencyData;
        Analyser.prototype.getFloatFrequencyData = function (array: Float32Array) {
          original.call(this, array as Float32Array<ArrayBuffer>);
          for (let i = 0; i < array.length; i++) {
            array[i] = (array[i] ?? 0) + (seeded(i) - 0.5) * 0.0001;
          }
        };
      }
    } catch {
      /* ignore */
    }
  }

  // WebRTC replace / disabled
  if (p.webrtcMode === "disabled") {
    try {
      Object.defineProperty(window, "RTCPeerConnection", {
        get: () => undefined,
        configurable: true,
      });
      Object.defineProperty(window, "webkitRTCPeerConnection", {
        get: () => undefined,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
  } else if (p.webrtcMode === "replace") {
    try {
      const Original = window.RTCPeerConnection;
      if (Original) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Wrapped = function (this: RTCPeerConnection, ...args: any[]) {
          const pc = new (Original as unknown as new (...a: unknown[]) => RTCPeerConnection)(...args);
          const origAdd = pc.addEventListener.bind(pc);
          pc.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
            if (type === "icecandidate") {
              const wrapped: EventListener = (ev) => {
                const e = ev as RTCPeerConnectionIceEvent;
                if (e.candidate && /typ host/i.test(e.candidate.candidate)) {
                  return; // drop host candidates (IP local)
                }
                if (typeof listener === "function") listener.call(pc, ev);
                else listener.handleEvent(ev);
              };
              return origAdd(type, wrapped, options);
            }
            return origAdd(type, listener, options);
          };
          return pc;
        } as unknown as typeof RTCPeerConnection;
        Wrapped.prototype = Original.prototype;
        Object.defineProperty(window, "RTCPeerConnection", {
          value: Wrapped,
          configurable: true,
        });
      }
    } catch {
      /* ignore */
    }
  }

  // MAC / deviceName: não há API padrão; expõe só para debug interno.
  try {
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      get: () => undefined,
      configurable: true,
    });
  } catch {
    /* ignore */
  }

  void p.macAddress;
  void p.deviceScaleFactor;
}

/** Delay curto “humano” (ms) entre ações sensíveis. */
export function humanPauseMs(minMs = 700, maxMs = 1_800): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
