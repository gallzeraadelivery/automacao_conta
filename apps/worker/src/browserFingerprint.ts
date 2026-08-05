/**
 * Perfil de fingerprint completo (estilo AdsPower) para `browser.newContext`.
 * Na rotação de sessão o **pacote inteiro** muda — não só o User-Agent.
 *
 * - **Desktop** no signup.
 * - **Mobile** só pós-conta (Take Photo Veriff/Socure).
 */

export type WebRtcMode = "replace" | "disabled" | "real";
export type NoiseMode = "real" | "noise";

export interface BrowserFingerprint {
  id: string;
  userAgent: string;
  /** Viewport = resolução lógica (coerente com UA / deviceScaleFactor). */
  viewport: { width: number; height: number };
  timezoneId: string;
  locale: string;
  deviceScaleFactor: number;
  isMobile?: boolean;
  hasTouch?: boolean;

  /** navigator.hardwareConcurrency */
  hardwareConcurrency: number;
  /** navigator.deviceMemory (GB) — Chrome desktop. */
  deviceMemory: number;
  /** Nome amigável do “dispositivo” (auditoria / spoof leve). */
  deviceName: string;
  /** MAC só documental — Chromium não expõe MAC real via JS. */
  macAddress: string;
  /** WebGL UNMASKED_VENDOR_WEBGL */
  webglVendor: string;
  /** WebGL UNMASKED_RENDERER_WEBGL */
  webglRenderer: string;
  /** Seed hex p/ ruído AudioContext (ex.: FDDC599A). */
  audioNoiseSeed: string;
  canvasMode: NoiseMode;
  webglImageMode: NoiseMode;
  webrtcMode: WebRtcMode;
  /** navigator.platform coerente com UA. */
  platform: string;
  /** maxTouchPoints */
  maxTouchPoints: number;
}

function desktop(
  partial: Omit<BrowserFingerprint, "canvasMode" | "webglImageMode" | "webrtcMode" | "maxTouchPoints"> &
    Partial<Pick<BrowserFingerprint, "canvasMode" | "webglImageMode" | "webrtcMode" | "maxTouchPoints">>,
): BrowserFingerprint {
  return {
    canvasMode: "noise",
    webglImageMode: "real",
    webrtcMode: "replace",
    maxTouchPoints: 0,
    ...partial,
  };
}

function mobile(
  partial: Omit<BrowserFingerprint, "canvasMode" | "webglImageMode" | "webrtcMode" | "deviceMemory"> &
    Partial<Pick<BrowserFingerprint, "canvasMode" | "webglImageMode" | "webrtcMode" | "deviceMemory">>,
): BrowserFingerprint {
  return {
    canvasMode: "noise",
    webglImageMode: "real",
    webrtcMode: "replace",
    deviceMemory: 4,
    isMobile: true,
    hasTouch: true,
    ...partial,
  };
}

/** Desktop — signup / portal até criar a conta (Mac/Win/Linux mistos). */
export const DESKTOP_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  desktop({
    id: "chrome-mac-1440",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 2,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    deviceName: "Julia's iMac",
    macAddress: "88:e9:fe:0c:5f:51",
    webglVendor: "Google Inc. (Intel Inc.)",
    webglRenderer:
      "ANGLE (Intel, ANGLE Metal Renderer: Intel HD Graphics 4000 OpenGL Engine, Unspecified Version)",
    audioNoiseSeed: "FDDC599A",
    platform: "MacIntel",
  }),
  desktop({
    id: "chrome-win-1920",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    timezoneId: "America/Chicago",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    deviceName: "DESKTOP-K8F2M1",
    macAddress: "a4:83:e7:2b:91:0c",
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    audioNoiseSeed: "A71C3E02",
    platform: "Win32",
  }),
  desktop({
    id: "chrome-mac-1680",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1680, height: 1050 },
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    deviceScaleFactor: 2,
    hardwareConcurrency: 10,
    deviceMemory: 16,
    deviceName: "Marcus's MacBook Pro",
    macAddress: "3c:22:fb:8a:44:19",
    webglVendor: "Google Inc. (Apple)",
    webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)",
    audioNoiseSeed: "B0E41D77",
    platform: "MacIntel",
  }),
  desktop({
    id: "chrome-win-1366",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    timezoneId: "America/Denver",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 4,
    deviceMemory: 8,
    deviceName: "LAPTOP-9QH2",
    macAddress: "00:1a:2b:3c:4d:5e",
    webglVendor: "Google Inc. (Intel)",
    webglRenderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    audioNoiseSeed: "C3F90A11",
    platform: "Win32",
  }),
  desktop({
    id: "chrome-linux-1920",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 16,
    deviceMemory: 16,
    deviceName: "dev-workstation",
    macAddress: "52:54:00:12:34:56",
    webglVendor: "Google Inc. (Intel Open Source Technology Center)",
    webglRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)",
    audioNoiseSeed: "D4E8B2C0",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-win-1536",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1536, height: 864 },
    timezoneId: "America/Phoenix",
    locale: "en-US",
    deviceScaleFactor: 1.25,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    deviceName: "Office-PC-07",
    macAddress: "d4:6a:6a:1f:22:88",
    webglVendor: "Google Inc. (AMD)",
    webglRenderer: "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)",
    audioNoiseSeed: "E19A7044",
    platform: "Win32",
  }),
  desktop({
    id: "chrome-mac-1512",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1512, height: 982 },
    timezoneId: "America/Chicago",
    locale: "en-US",
    deviceScaleFactor: 2,
    hardwareConcurrency: 12,
    deviceMemory: 32,
    deviceName: "Studio Display Mac",
    macAddress: "f0:18:98:aa:bb:01",
    webglVendor: "Google Inc. (Apple)",
    webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)",
    audioNoiseSeed: "F6C2D891",
    platform: "MacIntel",
  }),
  desktop({
    id: "chrome-win-1280",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 6,
    deviceMemory: 8,
    deviceName: "HOME-PC-ANA",
    macAddress: "b8:27:eb:de:ad:01",
    webglVendor: "Google Inc. (Intel)",
    webglRenderer: "ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    audioNoiseSeed: "1A2B3C4D",
    platform: "Win32",
  }),
];

/**
 * Desktop Linux x86_64 — coerente com Chromium em Docker/linux amd64.
 * Sem Mac/Metal nem Direct3D (sinais óbvios de spoof no Arkose).
 */
export const LINUX_DESKTOP_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  desktop({
    id: "chrome-linux-1920-uhd",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 16,
    deviceName: "linux-desktop-01",
    macAddress: "52:54:00:a1:b2:c3",
    webglVendor: "Google Inc. (Intel Open Source Technology Center)",
    webglRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)",
    audioNoiseSeed: "L1NUX001",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-linux-1680-mesa",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1680, height: 1050 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    deviceName: "linux-desktop-02",
    macAddress: "52:54:00:d4:e5:f6",
    webglVendor: "Google Inc. (Intel)",
    webglRenderer: "ANGLE (Intel, Mesa Intel(R) Iris Xe Graphics, OpenGL 4.6)",
    audioNoiseSeed: "L1NUX002",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-linux-1440-amd",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 16,
    deviceMemory: 32,
    deviceName: "linux-workstation",
    macAddress: "52:54:00:11:22:33",
    webglVendor: "Google Inc. (AMD)",
    webglRenderer: "ANGLE (AMD, AMD Radeon Graphics (radeonsi, renoir), OpenGL 4.6)",
    audioNoiseSeed: "L1NUX003",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-linux-1366-nv",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 6,
    deviceMemory: 8,
    deviceName: "linux-laptop",
    macAddress: "52:54:00:44:55:66",
    webglVendor: "Google Inc. (NVIDIA Corporation)",
    webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650/PCIe/SSE2, OpenGL 4.6)",
    audioNoiseSeed: "L1NUX004",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-linux-1536-llvmpipe",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1536, height: 864 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 4,
    deviceMemory: 8,
    deviceName: "linux-vm-01",
    macAddress: "52:54:00:77:88:99",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), OpenGL ES 3.2)",
    audioNoiseSeed: "L1NUX005",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-linux-1280-uhd",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 16,
    deviceName: "linux-office",
    macAddress: "52:54:00:aa:bb:cc",
    webglVendor: "Google Inc. (Intel Open Source Technology Center)",
    webglRenderer: "ANGLE (Intel, Mesa Intel(R) HD Graphics 620, OpenGL 4.6)",
    audioNoiseSeed: "L1NUX006",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-linux-1600-mesa",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1600, height: 900 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 10,
    deviceMemory: 16,
    deviceName: "linux-desk-07",
    macAddress: "52:54:00:de:ad:01",
    webglVendor: "Google Inc. (Intel)",
    webglRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 730, OpenGL 4.6)",
    audioNoiseSeed: "L1NUX007",
    platform: "Linux x86_64",
  }),
  desktop({
    id: "chrome-linux-1920-swift",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 4,
    deviceMemory: 4,
    deviceName: "linux-ci",
    macAddress: "52:54:00:c1:c1:01",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), OpenGL ES 3.2)",
    audioNoiseSeed: "L1NUX008",
    platform: "Linux x86_64",
  }),
];

/**
 * Desktop Linux aarch64 — Docker Desktop no Mac (container arm64).
 * Coerente com Chromium linux-arm64 (sem spoof Mac/Win).
 */
export const LINUX_ARM_DESKTOP_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  desktop({
    id: "chrome-linux-arm-1920",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    deviceName: "linux-arm-desktop",
    macAddress: "02:42:ac:11:00:02",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), OpenGL ES 3.2)",
    audioNoiseSeed: "LARM0001",
    platform: "Linux aarch64",
  }),
  desktop({
    id: "chrome-linux-arm-1680",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1680, height: 1050 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 10,
    deviceMemory: 16,
    deviceName: "linux-arm-ws",
    macAddress: "02:42:ac:11:00:03",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), OpenGL ES 3.2)",
    audioNoiseSeed: "LARM0002",
    platform: "Linux aarch64",
  }),
  desktop({
    id: "chrome-linux-arm-1440",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 4,
    deviceMemory: 4,
    deviceName: "linux-arm-vm",
    macAddress: "02:42:ac:11:00:04",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, OpenGL ES 3.0 (swiftshader), OpenGL ES 3.0)",
    audioNoiseSeed: "LARM0003",
    platform: "Linux aarch64",
  }),
  desktop({
    id: "chrome-linux-arm-1366",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 6,
    deviceMemory: 8,
    deviceName: "linux-arm-lap",
    macAddress: "02:42:ac:11:00:05",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), OpenGL ES 3.2)",
    audioNoiseSeed: "LARM0004",
    platform: "Linux aarch64",
  }),
  desktop({
    id: "chrome-linux-arm-1600",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1600, height: 900 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    deviceName: "linux-arm-07",
    macAddress: "02:42:ac:11:00:06",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), OpenGL ES 3.2)",
    audioNoiseSeed: "LARM0005",
    platform: "Linux aarch64",
  }),
  desktop({
    id: "chrome-linux-arm-1280",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 4,
    deviceMemory: 4,
    deviceName: "linux-arm-ci",
    macAddress: "02:42:ac:11:00:07",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, OpenGL ES 3.0 (swiftshader), OpenGL ES 3.0)",
    audioNoiseSeed: "LARM0006",
    platform: "Linux aarch64",
  }),
  desktop({
    id: "chrome-linux-arm-1536",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1536, height: 864 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    deviceName: "linux-arm-big",
    macAddress: "02:42:ac:11:00:08",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), OpenGL ES 3.2)",
    audioNoiseSeed: "LARM0007",
    platform: "Linux aarch64",
  }),
  desktop({
    id: "chrome-linux-arm-1800",
    userAgent:
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1800, height: 1169 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    deviceName: "linux-arm-wide",
    macAddress: "02:42:ac:11:00:09",
    webglVendor: "Google Inc. (Google)",
    webglRenderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), OpenGL ES 3.2)",
    audioNoiseSeed: "LARM0008",
    platform: "Linux aarch64",
  }),
];

/** Mobile — signup + hub. Só Android / iPhone (sem desktop). */
export const MOBILE_ANDROID_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  mobile({
    id: "chrome-android-pixel7",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 2.625,
    hardwareConcurrency: 8,
    deviceName: "Pixel 7",
    macAddress: "02:00:00:00:00:01",
    webglVendor: "Google Inc. (Qualcomm)",
    webglRenderer: "Adreno (TM) 730",
    audioNoiseSeed: "M0B1LE01",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  }),
  mobile({
    id: "chrome-android-pixel8",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 2.625,
    hardwareConcurrency: 8,
    deviceName: "Pixel 8",
    macAddress: "02:00:00:00:00:03",
    webglVendor: "Google Inc. (Qualcomm)",
    webglRenderer: "Adreno (TM) 740",
    audioNoiseSeed: "M0B1LE03",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  }),
  mobile({
    id: "chrome-android-samsung-s23",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S911U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { width: 360, height: 780 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 3,
    hardwareConcurrency: 8,
    deviceName: "SM-S911U",
    macAddress: "02:00:00:00:00:04",
    webglVendor: "Qualcomm",
    webglRenderer: "Adreno (TM) 740",
    audioNoiseSeed: "M0B1LE04",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  }),
  mobile({
    id: "chrome-android-pixel6a",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 2.625,
    hardwareConcurrency: 8,
    deviceName: "Pixel 6a",
    macAddress: "02:00:00:00:00:05",
    webglVendor: "Google Inc. (Qualcomm)",
    webglRenderer: "Adreno (TM) 642",
    audioNoiseSeed: "M0B1LE05",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  }),
];

export const MOBILE_IOS_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  mobile({
    id: "safari-iphone-15",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    viewport: { width: 393, height: 852 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 3,
    hardwareConcurrency: 6,
    deviceName: "iPhone 15",
    macAddress: "02:00:00:00:00:12",
    webglVendor: "Apple Inc.",
    webglRenderer: "Apple GPU",
    audioNoiseSeed: "M0B1LE02",
    platform: "iPhone",
    maxTouchPoints: 5,
  }),
  mobile({
    id: "safari-iphone-14",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 3,
    hardwareConcurrency: 6,
    deviceName: "iPhone 14",
    macAddress: "02:00:00:00:00:13",
    webglVendor: "Apple Inc.",
    webglRenderer: "Apple GPU",
    audioNoiseSeed: "M0B1LE06",
    platform: "iPhone",
    maxTouchPoints: 5,
  }),
  mobile({
    id: "safari-iphone-13",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 3,
    hardwareConcurrency: 6,
    deviceName: "iPhone 13",
    macAddress: "02:00:00:00:00:14",
    webglVendor: "Apple Inc.",
    webglRenderer: "Apple GPU",
    audioNoiseSeed: "M0B1LE07",
    platform: "iPhone",
    maxTouchPoints: 5,
  }),
  mobile({
    id: "safari-iphone-15-pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    viewport: { width: 393, height: 852 },
    timezoneId: "America/New_York",
    locale: "en-US",
    deviceScaleFactor: 3,
    hardwareConcurrency: 6,
    deviceName: "iPhone 15 Pro",
    macAddress: "02:00:00:00:00:15",
    webglVendor: "Apple Inc.",
    webglRenderer: "Apple GPU",
    audioNoiseSeed: "M0B1LE08",
    platform: "iPhone",
    maxTouchPoints: 5,
  }),
];

/** Pool unificado (Android + iPhone) — legado / testes. */
export const MOBILE_FINGERPRINT_POOL: readonly BrowserFingerprint[] = [
  ...MOBILE_ANDROID_FINGERPRINT_POOL,
  ...MOBILE_IOS_FINGERPRINT_POOL,
];

export const BROWSER_FINGERPRINT_POOL = DESKTOP_FINGERPRINT_POOL;

export type FingerprintOsMode = "mixed" | "linux" | "linux-arm" | "auto";

/** Resolve pool desktop coerente com o runtime (Docker Linux). */
export function resolveDesktopFingerprintPool(
  mode: FingerprintOsMode = "auto",
): readonly BrowserFingerprint[] {
  const resolved: Exclude<FingerprintOsMode, "auto"> =
    mode === "auto"
      ? process.platform === "linux"
        ? process.arch === "arm64"
          ? "linux-arm"
          : "linux"
        : "mixed"
      : mode;

  if (resolved === "linux-arm") return LINUX_ARM_DESKTOP_FINGERPRINT_POOL;
  if (resolved === "linux") return LINUX_DESKTOP_FINGERPRINT_POOL;
  return DESKTOP_FINGERPRINT_POOL;
}

export function pickFingerprint(attemptIndex: number): BrowserFingerprint {
  return pickSignupMobileFingerprint(attemptIndex);
}

export function pickDesktopFingerprint(
  attemptIndex: number,
  mode?: FingerprintOsMode,
): BrowserFingerprint {
  const pool = resolveDesktopFingerprintPool(
    mode ?? ((process.env.AUTOMATION_FINGERPRINT_OS as FingerprintOsMode | undefined) || "auto"),
  );
  return pool[attemptIndex % pool.length]!;
}

/**
 * Signup sempre Android: rotaciona fingerprints Android a cada índice
 * (aplicação / rotação de sessão). iOS desativado.
 */
export function pickSignupMobileFingerprint(attemptIndex: number): BrowserFingerprint {
  const pool = MOBILE_ANDROID_FINGERPRINT_POOL;
  return pool[attemptIndex % pool.length]!;
}

export function pickMobileFingerprint(attemptIndex: number): BrowserFingerprint {
  return pickSignupMobileFingerprint(attemptIndex);
}

export function mobilePlatformOf(fp: BrowserFingerprint): "android" | "ios" {
  return /iphone|ipad|CPU iPhone/i.test(fp.userAgent) || fp.platform === "iPhone"
    ? "ios"
    : "android";
}

/** Payload serializável para `addInitScript` (sem funções). */
export function fingerprintInitPayload(fp: BrowserFingerprint): Record<string, unknown> {
  return {
    id: fp.id,
    hardwareConcurrency: fp.hardwareConcurrency,
    deviceMemory: fp.deviceMemory,
    deviceName: fp.deviceName,
    macAddress: fp.macAddress,
    webglVendor: fp.webglVendor,
    webglRenderer: fp.webglRenderer,
    audioNoiseSeed: fp.audioNoiseSeed,
    canvasMode: fp.canvasMode,
    webglImageMode: fp.webglImageMode,
    webrtcMode: fp.webrtcMode,
    platform: fp.platform,
    maxTouchPoints: fp.maxTouchPoints,
    locale: fp.locale,
    languages: fp.locale.toLowerCase().startsWith("en")
      ? [fp.locale, "en"]
      : [fp.locale, "en-US", "en"],
    screenWidth: fp.viewport.width,
    screenHeight: fp.viewport.height,
    deviceScaleFactor: fp.deviceScaleFactor,
  };
}
