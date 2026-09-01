import crypto from "node:crypto";
import {
  LICENSE_KEY_CHARSET,
  LICENSE_KEY_PREFIX,
  isValidLicenseKeyFormat,
  normalizeLicenseKey,
} from "@uber-automation/license-shared";

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = crypto.randomInt(0, LICENSE_KEY_CHARSET.length);
    out += LICENSE_KEY_CHARSET[idx];
  }
  return out;
}

export function generateLicenseKey(): string {
  return `${LICENSE_KEY_PREFIX}-${randomSegment(4)}-${randomSegment(4)}`;
}

export function assertLicenseKey(key: string): string {
  const normalized = normalizeLicenseKey(key);
  if (!isValidLicenseKeyFormat(normalized)) {
    throw new Error("Formato de chave inválido (GD-XXXX-XXXX)");
  }
  return normalized;
}
