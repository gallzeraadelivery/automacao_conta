import { describe, expect, it } from "vitest";
import {
  MOBILE_ANDROID_FINGERPRINT_POOL,
  fingerprintInitPayload,
  mobilePlatformOf,
  pickMobileFingerprint,
  pickSignupMobileFingerprint,
} from "./browserFingerprint";
import { fingerprintRotationKey } from "./fingerprintRotation";

describe("pickSignupMobileFingerprint (somente Android)", () => {
  it("sempre Android e rotaciona o pool", () => {
    expect(mobilePlatformOf(pickSignupMobileFingerprint(0))).toBe("android");
    expect(mobilePlatformOf(pickSignupMobileFingerprint(1))).toBe("android");
    expect(pickSignupMobileFingerprint(0).id).toBe(MOBILE_ANDROID_FINGERPRINT_POOL[0]!.id);
    expect(pickSignupMobileFingerprint(1).id).toBe(MOBILE_ANDROID_FINGERPRINT_POOL[1]!.id);
    expect(
      pickSignupMobileFingerprint(MOBILE_ANDROID_FINGERPRINT_POOL.length).id,
    ).toBe(MOBILE_ANDROID_FINGERPRINT_POOL[0]!.id);
  });

  it("pickMobileFingerprint = signup Android", () => {
    expect(pickMobileFingerprint(2).id).toBe(pickSignupMobileFingerprint(2).id);
  });

  it("cada Android tem pacote touch + seeds", () => {
    for (const fp of MOBILE_ANDROID_FINGERPRINT_POOL) {
      expect(fp.isMobile).toBe(true);
      expect(fp.hasTouch).toBe(true);
      expect(fp.maxTouchPoints).toBeGreaterThan(0);
      expect(fp.viewport.width).toBeLessThan(500);
      expect(fp.userAgent).toMatch(/Android/i);
      expect(fp.audioNoiseSeed.length).toBeGreaterThan(0);
    }
  });

  it("fingerprintInitPayload serializável", () => {
    const payload = fingerprintInitPayload(pickSignupMobileFingerprint(0));
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe("fingerprintRotationKey", () => {
  it("chave estável por applicant", () => {
    expect(fingerprintRotationKey("abc")).toBe("automation:fingerprint-index:abc");
  });
});
