import { DatabaseSync } from "node:sqlite";
import type { LicenseStatus } from "@uber-automation/license-shared";

export interface LicenseRow {
  id: string;
  licenseKey: string;
  label: string | null;
  status: LicenseStatus;
  maxMachines: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationRow {
  id: string;
  licenseKey: string;
  machineId: string;
  hostname: string;
  platform: string | null;
  appVersion: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export class LicenseDatabase {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS licenses (
        id TEXT PRIMARY KEY NOT NULL,
        license_key TEXT NOT NULL UNIQUE,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        max_machines INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activations (
        id TEXT PRIMARY KEY NOT NULL,
        license_key TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        hostname TEXT NOT NULL,
        app_version TEXT,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(license_key, machine_id)
      );
      CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_key);
    `);
    try {
      this.db.exec(`ALTER TABLE activations ADD COLUMN platform TEXT`);
    } catch {
      // coluna já existe
    }
  }

  listLicenses(): LicenseRow[] {
    return this.db
      .prepare(
        `SELECT id, license_key AS licenseKey, label, status, max_machines AS maxMachines,
                expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt
         FROM licenses ORDER BY created_at DESC`,
      )
      .all() as LicenseRow[];
  }

  getLicense(licenseKey: string): LicenseRow | undefined {
    return this.db
      .prepare(
        `SELECT id, license_key AS licenseKey, label, status, max_machines AS maxMachines,
                expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt
         FROM licenses WHERE license_key = ?`,
      )
      .get(licenseKey) as LicenseRow | undefined;
  }

  insertLicense(row: LicenseRow): void {
    this.db
      .prepare(
        `INSERT INTO licenses (id, license_key, label, status, max_machines, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.licenseKey,
        row.label,
        row.status,
        row.maxMachines,
        row.expiresAt,
        row.createdAt,
        row.updatedAt,
      );
  }

  updateLicenseFields(
    licenseKey: string,
    fields: { maxMachines?: number; label?: string | null },
    updatedAt: string,
  ): void {
    const sets: string[] = ["updated_at = ?"];
    const values: Array<string | number | null> = [updatedAt];
    if (fields.maxMachines !== undefined) {
      sets.push("max_machines = ?");
      values.push(fields.maxMachines);
    }
    if (fields.label !== undefined) {
      sets.push("label = ?");
      values.push(fields.label);
    }
    values.push(licenseKey);
    this.db
      .prepare(`UPDATE licenses SET ${sets.join(", ")} WHERE license_key = ?`)
      .run(...values);
  }

  updateLicenseStatus(licenseKey: string, status: LicenseStatus, updatedAt: string): void {
    this.db
      .prepare(`UPDATE licenses SET status = ?, updated_at = ? WHERE license_key = ?`)
      .run(status, updatedAt, licenseKey);
  }

  countActivations(licenseKey: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM activations WHERE license_key = ?`)
      .get(licenseKey) as { c: number };
    return row?.c ?? 0;
  }

  listActivations(licenseKey: string): ActivationRow[] {
    return this.db
      .prepare(
        `SELECT id, license_key AS licenseKey, machine_id AS machineId, hostname,
                platform, app_version AS appVersion, last_seen_at AS lastSeenAt, created_at AS createdAt
         FROM activations WHERE license_key = ? ORDER BY last_seen_at DESC`,
      )
      .all(licenseKey) as ActivationRow[];
  }

  getActivation(licenseKey: string, machineId: string): ActivationRow | undefined {
    return this.db
      .prepare(
        `SELECT id, license_key AS licenseKey, machine_id AS machineId, hostname,
                platform, app_version AS appVersion, last_seen_at AS lastSeenAt, created_at AS createdAt
         FROM activations WHERE license_key = ? AND machine_id = ?`,
      )
      .get(licenseKey, machineId) as ActivationRow | undefined;
  }

  insertActivation(row: ActivationRow): void {
    this.db
      .prepare(
        `INSERT INTO activations (id, license_key, machine_id, hostname, platform, app_version, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.licenseKey,
        row.machineId,
        row.hostname,
        row.platform,
        row.appVersion,
        row.lastSeenAt,
        row.createdAt,
      );
  }

  deleteActivation(licenseKey: string, machineId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM activations WHERE license_key = ? AND machine_id = ?`)
      .run(licenseKey, machineId);
    return result.changes > 0;
  }

  touchActivation(
    id: string,
    hostname: string,
    platform: string | null,
    appVersion: string | null,
    lastSeenAt: string,
  ): void {
    this.db
      .prepare(
        `UPDATE activations SET hostname = ?, platform = ?, app_version = ?, last_seen_at = ? WHERE id = ?`,
      )
      .run(hostname, platform, appVersion, lastSeenAt, id);
  }

  heartbeatActivation(id: string, lastSeenAt: string): void {
    this.db.prepare(`UPDATE activations SET last_seen_at = ? WHERE id = ?`).run(lastSeenAt, id);
  }
}

export function createDb(dbPath: string): LicenseDatabase {
  return new LicenseDatabase(dbPath);
}

export type LicenseDb = LicenseDatabase;
