import { mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import {
  PROFILE_FILES,
  PROFILE_SITES,
  type ProfileSite,
  type ProfileSiteData,
} from "./browserProfile.types";

const LOCK_FILE_NAME = "LOCK";

function defaultContentFor(file: (typeof PROFILE_FILES)[number]): string {
  return file === "cookies.json" ? "[]" : "{}";
}

export function resolveProfileDir(storageRoot: string, applicantId: string): string {
  return path.join(storageRoot, `applicant-${applicantId}`);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Cria (ou reseta) a estrutura de diretorios/arquivos vazios de um perfil. */
export async function initializeProfileFiles(profileDir: string): Promise<void> {
  for (const site of PROFILE_SITES) {
    const siteDir = path.join(profileDir, site);
    await mkdir(siteDir, { recursive: true });
    for (const file of PROFILE_FILES) {
      await writeFile(path.join(siteDir, file), defaultContentFor(file), "utf8");
    }
  }
}

export interface ProfileIntegrityResult {
  intact: boolean;
  missingFiles: string[];
  invalidJsonFiles: string[];
}

export async function checkProfileIntegrity(profileDir: string): Promise<ProfileIntegrityResult> {
  const missingFiles: string[] = [];
  const invalidJsonFiles: string[] = [];

  for (const site of PROFILE_SITES) {
    for (const file of PROFILE_FILES) {
      const filePath = path.join(profileDir, site, file);
      if (!(await pathExists(filePath))) {
        missingFiles.push(`${site}/${file}`);
        continue;
      }
      try {
        JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        invalidJsonFiles.push(`${site}/${file}`);
      }
    }
  }

  return {
    intact: missingFiles.length === 0 && invalidJsonFiles.length === 0,
    missingFiles,
    invalidJsonFiles,
  };
}

export async function readProfileData(
  profileDir: string,
): Promise<Record<ProfileSite, ProfileSiteData>> {
  const result = {} as Record<ProfileSite, ProfileSiteData>;

  for (const site of PROFILE_SITES) {
    const siteDir = path.join(profileDir, site);
    const [cookies, localStorage, sessionStorage] = await Promise.all([
      readJsonOrDefault(path.join(siteDir, "cookies.json"), []),
      readJsonOrDefault(path.join(siteDir, "localStorage.json"), {}),
      readJsonOrDefault(path.join(siteDir, "sessionStorage.json"), {}),
    ]);
    result[site] = { cookies, localStorage, sessionStorage };
  }

  return result;
}

async function readJsonOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeSiteData(
  profileDir: string,
  site: ProfileSite,
  data: Partial<ProfileSiteData>,
): Promise<void> {
  const siteDir = path.join(profileDir, site);
  await mkdir(siteDir, { recursive: true });
  if (data.cookies !== undefined) {
    await writeFile(path.join(siteDir, "cookies.json"), JSON.stringify(data.cookies), "utf8");
  }
  if (data.localStorage !== undefined) {
    await writeFile(
      path.join(siteDir, "localStorage.json"),
      JSON.stringify(data.localStorage),
      "utf8",
    );
  }
  if (data.sessionStorage !== undefined) {
    await writeFile(
      path.join(siteDir, "sessionStorage.json"),
      JSON.stringify(data.sessionStorage),
      "utf8",
    );
  }
}

/** Marca o diretorio do perfil com um bloqueio de seguranca (ex: 2FA/CAPTCHA detectado). */
export async function lockProfileDir(profileDir: string, reason: string): Promise<void> {
  await mkdir(profileDir, { recursive: true });
  await writeFile(
    path.join(profileDir, LOCK_FILE_NAME),
    JSON.stringify({ reason, lockedAt: new Date().toISOString() }),
    "utf8",
  );
}

export async function isProfileLocked(profileDir: string): Promise<boolean> {
  return pathExists(path.join(profileDir, LOCK_FILE_NAME));
}

export async function unlockProfileDir(profileDir: string): Promise<void> {
  const lockPath = path.join(profileDir, LOCK_FILE_NAME);
  if (await pathExists(lockPath)) {
    await rm(lockPath, { force: true });
  }
}

export async function wipeProfileDir(profileDir: string): Promise<void> {
  await rm(profileDir, { recursive: true, force: true });
}
