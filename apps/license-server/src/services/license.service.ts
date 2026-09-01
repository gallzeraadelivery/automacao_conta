import crypto from "node:crypto";
import type { LicenseClientStatus, LicenseStatus } from "@uber-automation/license-shared";
import type { LicenseDb } from "../db/index.js";
import { assertLicenseKey, generateLicenseKey } from "../lib/keys.js";

const ONLINE_THRESHOLD_MS = 20 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() <= ONLINE_THRESHOLD_MS;
}

function hasMachineLimit(maxMachines: number): boolean {
  return maxMachines > 0;
}

function toClientStatus(
  ok: boolean,
  status: LicenseStatus | "unknown",
  message: string,
  expiresAt?: string | null,
): LicenseClientStatus {
  return { ok, status, message, expiresAt: expiresAt ?? null };
}

function mapActivation(a: ReturnType<LicenseDb["listActivations"]>[number]) {
  return {
    ...a,
    online: isOnline(a.lastSeenAt),
  };
}

export class LicenseService {
  constructor(private readonly db: LicenseDb) {}

  listLicenses() {
    return this.db.listLicenses().map((row) => {
      const activations = this.db.listActivations(row.licenseKey).map(mapActivation);
      return {
        ...row,
        unlimited: !hasMachineLimit(row.maxMachines),
        activationCount: activations.length,
        activations,
      };
    });
  }

  listActivations(licenseKey: string) {
    const key = assertLicenseKey(licenseKey);
    return this.db.listActivations(key).map(mapActivation);
  }

  createLicense(input: { label?: string; maxMachines?: number; expiresAt?: string | null }) {
    const ts = nowIso();
    let licenseKey = generateLicenseKey();
    for (let i = 0; i < 5; i++) {
      if (!this.db.getLicense(licenseKey)) break;
      licenseKey = generateLicenseKey();
    }
    const rawMax = input.maxMachines ?? 1;
    const row = {
      id: crypto.randomUUID(),
      licenseKey,
      label: input.label?.trim() || null,
      status: "active" as const,
      maxMachines: rawMax <= 0 ? 0 : Math.max(1, rawMax),
      expiresAt: input.expiresAt ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db.insertLicense(row);
    return row;
  }

  updateLicense(
    licenseKey: string,
    input: { maxMachines?: number; label?: string | null },
  ) {
    const key = assertLicenseKey(licenseKey);
    const existing = this.db.getLicense(key);
    if (!existing) throw new Error("Licença não encontrada");

    const updatedAt = nowIso();
    const fields: { maxMachines?: number; label?: string | null } = {};
    if (input.label !== undefined) fields.label = input.label?.trim() || null;
    if (input.maxMachines !== undefined) {
      fields.maxMachines = input.maxMachines <= 0 ? 0 : Math.max(1, input.maxMachines);
    }
    this.db.updateLicenseFields(key, fields, updatedAt);
    return {
      ...existing,
      ...fields,
      updatedAt,
      unlimited: fields.maxMachines !== undefined ? fields.maxMachines <= 0 : !hasMachineLimit(existing.maxMachines),
    };
  }

  removeActivation(licenseKey: string, machineId: string) {
    const key = assertLicenseKey(licenseKey);
    const removed = this.db.deleteActivation(key, machineId);
    if (!removed) throw new Error("Computador não encontrado nesta licença");
    return { ok: true };
  }

  setLicenseStatus(licenseKey: string, status: LicenseStatus) {
    const key = assertLicenseKey(licenseKey);
    const existing = this.db.getLicense(key);
    if (!existing) throw new Error("Licença não encontrada");
    const updatedAt = nowIso();
    this.db.updateLicenseStatus(key, status, updatedAt);
    return { ...existing, status, updatedAt };
  }

  activate(input: {
    licenseKey: string;
    machineId: string;
    hostname: string;
    platform?: string;
    appVersion?: string;
  }): LicenseClientStatus {
    const key = assertLicenseKey(input.licenseKey);
    const license = this.db.getLicense(key);
    if (!license) {
      return toClientStatus(false, "unknown", "Chave de licença inválida");
    }
    if (license.status === "revoked") {
      return toClientStatus(false, "revoked", "Licença revogada pelo administrador", license.expiresAt);
    }
    if (isExpired(license.expiresAt)) {
      this.db.updateLicenseStatus(key, "expired", nowIso());
      return toClientStatus(false, "expired", "Licença expirada", license.expiresAt);
    }

    const ts = nowIso();
    const existingActivation = this.db.getActivation(key, input.machineId);

    if (existingActivation) {
      this.db.touchActivation(
        existingActivation.id,
        input.hostname,
        input.platform ?? null,
        input.appVersion ?? null,
        ts,
      );
      return toClientStatus(true, "active", "Licença ativa", license.expiresAt);
    }

    const activeCount = this.db.countActivations(key);
    if (hasMachineLimit(license.maxMachines) && activeCount >= license.maxMachines) {
      return toClientStatus(
        false,
        "active",
        `Limite de computadores atingido (${license.maxMachines})`,
        license.expiresAt,
      );
    }

    this.db.insertActivation({
      id: crypto.randomUUID(),
      licenseKey: key,
      machineId: input.machineId,
      hostname: input.hostname,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      lastSeenAt: ts,
      createdAt: ts,
    });

    return toClientStatus(true, "active", "Licença ativada com sucesso", license.expiresAt);
  }

  heartbeat(input: { licenseKey: string; machineId: string }): LicenseClientStatus {
    const key = assertLicenseKey(input.licenseKey);
    const license = this.db.getLicense(key);
    if (!license) {
      return toClientStatus(false, "unknown", "Chave de licença inválida");
    }
    if (license.status === "revoked") {
      return toClientStatus(false, "revoked", "Licença revogada pelo administrador", license.expiresAt);
    }
    if (isExpired(license.expiresAt)) {
      return toClientStatus(false, "expired", "Licença expirada", license.expiresAt);
    }

    const activation = this.db.getActivation(key, input.machineId);
    if (!activation) {
      return toClientStatus(false, "unknown", "Computador não registrado — reinicie a aplicação");
    }

    this.db.heartbeatActivation(activation.id, nowIso());
    return toClientStatus(true, "active", "Heartbeat OK", license.expiresAt);
  }

  status(input: { licenseKey: string; machineId: string }): LicenseClientStatus {
    return this.heartbeat(input);
  }
}
