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

export async function startLicenseGuard(config: LicenseGuardConfig): Promise<{
  client: LicenseClient | null;
  stop: () => void;
  assertAllowed: () => void;
}> {
  if (!config.enabled) {
    console.warn("[license] Verificação desabilitada (LICENSE_ENABLED=false)");
    return { client: null, stop: () => {}, assertAllowed: () => {} };
  }
  if (!config.licenseKey?.trim()) {
    throw new Error("LICENSE_KEY é obrigatória (formato GD-XXXX-XXXX)");
  }

  const client = await ensureLicensed({
    serverUrl: config.serverUrl,
    licenseKey: config.licenseKey,
    baseDir: config.baseDir,
    appVersion: config.appVersion,
  });

  const intervalMs = config.heartbeatMs ?? 15 * 60 * 1000;
  const timer = setInterval(() => {
    void client.heartbeat().then((status) => {
      if (!status.ok) {
        console.error(`[license] Heartbeat falhou: ${status.message}`);
      }
    });
  }, intervalMs);
  timer.unref?.();

  return {
    client,
    stop: () => clearInterval(timer),
    assertAllowed: () => {
      if (!client.isLicensed()) {
        throw new Error(client.getState().message || "Licença inválida ou revogada");
      }
    },
  };
}
