import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isValidLicenseKeyFormat,
  normalizeLicenseKey,
  type LicenseClientStatus,
} from "@uber-automation/license-shared";

export interface LicenseClientOptions {
  serverUrl: string;
  licenseKey: string;
  /** Raiz da instalação (onde fica `.license-machine-id`). */
  baseDir?: string;
  machineId?: string;
  machineIdFile?: string;
  appVersion?: string;
  fetchImpl?: typeof fetch;
}

export interface LicenseGuardConfig {
  enabled: boolean;
  serverUrl: string;
  licenseKey?: string;
  licenseKeyFile?: string;
  baseDir: string;
  appVersion?: string;
  heartbeatMs?: number;
}

export interface LicenseClientState {
  ok: boolean;
  status: string;
  message: string;
  checkedAt: number;
}

const DEFAULT_MACHINE_ID_FILE = ".license-machine-id";
const DEFAULT_LICENSE_KEY_FILE = "storage/license.key";

export function resolveLicenseKeyFile(baseDir: string): string {
  return path.join(baseDir, DEFAULT_LICENSE_KEY_FILE);
}

export function readLicenseKeyFromFile(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return null;
    const key = normalizeLicenseKey(raw);
    return isValidLicenseKeyFormat(key) ? key : null;
  } catch {
    return null;
  }
}

export function writeLicenseKeyToFile(filePath: string, licenseKey: string): void {
  const key = normalizeLicenseKey(licenseKey);
  if (!isValidLicenseKeyFormat(key)) {
    throw new Error(`LICENSE_KEY invalida (esperado GD-XXXX-XXXX): ${licenseKey}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${key}\n`, "utf8");
}

export interface LicenseGuard {
  client: LicenseClient | null;
  stop: () => void;
  assertAllowed: () => void;
  getStatus: () => LicenseClientState & {
    enabled: boolean;
    configured: boolean;
    licenseKeyMasked: string | null;
    machineId: string | null;
  };
  activate: (licenseKey: string) => Promise<LicenseClient>;
  tryReloadFromFile: () => Promise<boolean>;
}

export function resolveMachineIdFile(baseDir: string): string {
  return path.join(baseDir, DEFAULT_MACHINE_ID_FILE);
}

/** ID estável por instalação (persistido em disco). */
export function getOrCreateMachineId(filePath: string): string {
  try {
    const existing = fs.readFileSync(filePath, "utf8").trim();
    if (existing.length >= 8) return existing;
  } catch {
    // novo
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, id, "utf8");
  return id;
}

export function buildDefaultMachineId(baseDir: string): string {
  return getOrCreateMachineId(resolveMachineIdFile(baseDir));
}

export class LicenseClient {
  private readonly serverUrl: string;
  private readonly licenseKey: string;
  private readonly machineId: string;
  private readonly appVersion: string;
  private readonly fetchImpl: typeof fetch;
  private state: LicenseClientState = {
    ok: false,
    status: "unknown",
    message: "Licença ainda não verificada",
    checkedAt: 0,
  };

  constructor(options: LicenseClientOptions) {
    const key = normalizeLicenseKey(options.licenseKey);
    if (!isValidLicenseKeyFormat(key)) {
      throw new Error(`LICENSE_KEY inválida (esperado GD-XXXX-XXXX): ${options.licenseKey}`);
    }
    this.licenseKey = key;
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    const idFile =
      options.machineIdFile ??
      resolveMachineIdFile(options.baseDir ?? path.resolve(process.cwd(), "../.."));
    this.machineId = options.machineId ?? getOrCreateMachineId(idFile);
    this.appVersion = options.appVersion ?? "0.0.0";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getState(): LicenseClientState {
    return { ...this.state };
  }

  isLicensed(): boolean {
    return this.state.ok;
  }

  async activate(): Promise<LicenseClientStatus> {
    return this.post("/api/v1/activate", {
      licenseKey: this.licenseKey,
      machineId: this.machineId,
      hostname: os.hostname(),
      platform: `${os.type()} ${os.platform()} ${os.arch()}`,
      appVersion: this.appVersion,
    });
  }

  async heartbeat(): Promise<LicenseClientStatus> {
    return this.post("/api/v1/heartbeat", {
      licenseKey: this.licenseKey,
      machineId: this.machineId,
    });
  }

  async validate(): Promise<LicenseClientStatus> {
    const url = new URL(`${this.serverUrl}/api/v1/status`);
    url.searchParams.set("licenseKey", this.licenseKey);
    url.searchParams.set("machineId", this.machineId);
    const res = await this.fetchImpl(url.toString(), { method: "GET" });
    const body = (await res.json()) as { success: boolean; data?: LicenseClientStatus; error?: { message: string } };
    if (!res.ok || !body.success || !body.data) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      this.state = { ok: false, status: "unknown", message: msg, checkedAt: Date.now() };
      return { ok: false, status: "unknown", message: msg };
    }
    this.applyStatus(body.data);
    return body.data;
  }

  private async post(pathname: string, payload: object): Promise<LicenseClientStatus> {
    const res = await this.fetchImpl(`${this.serverUrl}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { success: boolean; data?: LicenseClientStatus; error?: { message: string } };
    if (!res.ok || !body.success || !body.data) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      this.state = { ok: false, status: "unknown", message: msg, checkedAt: Date.now() };
      return { ok: false, status: "unknown", message: msg };
    }
    this.applyStatus(body.data);
    return body.data;
  }

  private applyStatus(data: LicenseClientStatus): void {
    this.state = {
      ok: data.ok,
      status: data.status,
      message: data.message,
      checkedAt: Date.now(),
    };
  }
}

export async function ensureLicensed(options: LicenseClientOptions): Promise<LicenseClient> {
  const client = new LicenseClient(options);
  await client.activate();
  if (!client.isLicensed()) {
    throw new Error(client.getState().message || "Licença não autorizada");
  }
  return client;
}

export async function startLicenseGuard(config: LicenseGuardConfig): Promise<LicenseGuard> {
  const baseDir = config.baseDir;
  const keyFile = config.licenseKeyFile ?? resolveLicenseKeyFile(baseDir);
  const machineIdFile = resolveMachineIdFile(baseDir);
  const machineId = getOrCreateMachineId(machineIdFile);

  if (!config.enabled) {
    console.warn("[license] Verificacao desabilitada (LICENSE_ENABLED=false)");
    return {
      client: null,
      stop: () => {},
      assertAllowed: () => {},
      getStatus: () => ({
        ok: true,
        status: "disabled",
        message: "Verificacao de licenca desabilitada",
        checkedAt: Date.now(),
        enabled: false,
        configured: true,
        licenseKeyMasked: null,
        machineId,
      }),
      activate: async () => {
        throw new Error("Licenca desabilitada nesta instalacao");
      },
      tryReloadFromFile: async () => false,
    };
  }

  let client: LicenseClient | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentKey: string | null = null;

  function maskKey(key: string | null): string | null {
    if (!key) return null;
    return `${key.slice(0, 3)}-****-****`;
  }

  function stopHeartbeat() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startHeartbeat(activeClient: LicenseClient) {
    stopHeartbeat();
    const intervalMs = config.heartbeatMs ?? 15 * 60 * 1000;
    timer = setInterval(() => {
      void activeClient.heartbeat().then((status) => {
        if (!status.ok) {
          console.error(`[license] Heartbeat falhou: ${status.message}`);
        }
      });
    }, intervalMs);
    timer.unref?.();
  }

  function resolveConfiguredKey(): string | null {
    const fromEnv = config.licenseKey?.trim();
    if (fromEnv && isValidLicenseKeyFormat(fromEnv)) {
      return normalizeLicenseKey(fromEnv);
    }
    return readLicenseKeyFromFile(keyFile);
  }

  async function loadClient(licenseKey: string): Promise<LicenseClient> {
    const next = await ensureLicensed({
      serverUrl: config.serverUrl,
      licenseKey,
      baseDir,
      appVersion: config.appVersion,
      machineIdFile,
    });
    client = next;
    currentKey = licenseKey;
    startHeartbeat(next);
    return next;
  }

  const initialKey = resolveConfiguredKey();
  if (initialKey) {
    try {
      await loadClient(initialKey);
      console.log(`[license] Licenca OK — ${client!.getState().message}`);
    } catch (error) {
      console.warn(`[license] Falha ao validar licenca inicial: ${(error as Error).message}`);
      client = null;
      currentKey = initialKey;
    }
  } else {
    console.warn("[license] Nenhuma chave configurada — aguardando ativacao no painel");
  }

  return {
    get client() {
      return client;
    },
    stop: () => {
      stopHeartbeat();
    },
    getStatus: () => {
      const state = client?.getState() ?? {
        ok: false,
        status: currentKey ? "unknown" : "missing",
        message: currentKey
          ? "Licenca invalida ou nao autorizada"
          : "Informe a chave GD-XXXX-XXXX no painel",
        checkedAt: 0,
      };
      return {
        ...state,
        enabled: true,
        configured: Boolean(currentKey ?? resolveConfiguredKey()),
        licenseKeyMasked: maskKey(currentKey ?? resolveConfiguredKey()),
        machineId,
      };
    },
    assertAllowed: () => {
      if (!client?.isLicensed()) {
        throw new Error(
          currentKey || resolveConfiguredKey()
            ? client?.getState().message || "Licenca invalida ou revogada"
            : "LICENSE_REQUIRED",
        );
      }
    },
    activate: async (licenseKey: string) => {
      writeLicenseKeyToFile(keyFile, licenseKey);
      const key = normalizeLicenseKey(licenseKey);
      currentKey = key;
      process.env.LICENSE_KEY = key;
      return loadClient(key);
    },
    tryReloadFromFile: async () => {
      if (client?.isLicensed()) return true;
      const key = resolveConfiguredKey();
      if (!key || key === currentKey) return false;
      try {
        await loadClient(key);
        return true;
      } catch {
        currentKey = key;
        client = null;
        return false;
      }
    },
  };
}
