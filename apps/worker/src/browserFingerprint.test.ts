import { describe, expect, it } from "vitest";
import {
  DESKTOP_FINGERPRINT_POOL,
  MOBILE_FINGERPRINT_POOL,
  pickDesktopFingerprint,
  pickFingerprint,
  pickMobileFingerprint,
} from "./browserFingerprint";

describe("pickFingerprint (signup = desktop)", () => {
  it("rotação desktop pelo índice", () => {
    expect(pickFingerprint(0).id).toBe(DESKTOP_FINGERPRINT_POOL[0]!.id);
    expect(pickFingerprint(1).id).toBe(DESKTOP_FINGERPRINT_POOL[1]!.id);
    expect(pickFingerprint(0).id).toBe(pickDesktopFingerprint(0).id);
  });

  it("desktop sem isMobile", () => {
    for (const fp of DESKTOP_FINGERPRINT_POOL) {
      expect(fp.isMobile).toBeFalsy();
      expect(fp.viewport.width).toBeGreaterThan(1000);
    }
  });
});

describe("pickMobileFingerprint (pós-conta)", () => {
  it("rotação Android/iPhone", () => {
    expect(pickMobileFingerprint(0).id).toBe("chrome-android-pixel7");
    expect(pickMobileFingerprint(1).id).toBe("safari-iphone-15");
  });

  it("cada mobile tem isMobile/hasTouch", () => {
    for (const fp of MOBILE_FINGERPRINT_POOL) {
      expect(fp.isMobile).toBe(true);
      expect(fp.hasTouch).toBe(true);
      expect(fp.viewport.width).toBeLessThan(500);
    }
  });
});
