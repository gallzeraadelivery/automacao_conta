import { describe, expect, it } from "vitest";
import {
  DEFAULT_EARN_TIMEZONE,
  alignFingerprintToProxy,
  timezoneForProxyRegion,
} from "./fingerprintAlign";
import { pickFingerprint } from "./browserFingerprint";
import { humanPauseMs, STEALTH_LAUNCH_ARGS, STEALTH_IGNORE_DEFAULT_ARGS } from "./browserStealth";

describe("timezoneForProxyRegion", () => {
  it("default Earn Orlando = US/Eastern", () => {
    expect(timezoneForProxyRegion(null)).toBe(DEFAULT_EARN_TIMEZONE);
    expect(timezoneForProxyRegion("")).toBe("America/New_York");
    expect(timezoneForProxyRegion("Florida")).toBe("America/New_York");
  });

  it("mapeia regiões comuns", () => {
    expect(timezoneForProxyRegion("us-west")).toBe("America/Los_Angeles");
    expect(timezoneForProxyRegion("Chicago IL")).toBe("America/Chicago");
    expect(timezoneForProxyRegion("Phoenix AZ")).toBe("America/Phoenix");
  });
});

describe("alignFingerprintToProxy", () => {
  it("sobrescreve timezone mantendo o pacote AdsPower-like", () => {
    const base = pickFingerprint(1);
    const aligned = alignFingerprintToProxy(base, "Orlando FL");
    expect(aligned.id).toBe(base.id);
    expect(aligned.timezoneId).toBe("America/New_York");
    expect(aligned.userAgent).toBe(base.userAgent);
    expect(aligned.deviceName).toBe(base.deviceName);
    expect(aligned.audioNoiseSeed).toBe(base.audioNoiseSeed);
    expect(aligned.webglRenderer).toBe(base.webglRenderer);
    expect(aligned.hardwareConcurrency).toBe(base.hardwareConcurrency);
    expect(aligned.webrtcMode).toBe(base.webrtcMode);
  });
});

describe("browserStealth helpers", () => {
  it("tem args de stealth, WebRTC e remove enable-automation", () => {
    expect(STEALTH_LAUNCH_ARGS.some((a) => a.includes("AutomationControlled"))).toBe(true);
    expect(STEALTH_LAUNCH_ARGS.some((a) => a.includes("webrtc-ip-handling"))).toBe(true);
    expect(STEALTH_IGNORE_DEFAULT_ARGS).toContain("--enable-automation");
  });

  it("humanPauseMs fica no intervalo", () => {
    for (let i = 0; i < 20; i++) {
      const n = humanPauseMs(100, 200);
      expect(n).toBeGreaterThanOrEqual(100);
      expect(n).toBeLessThanOrEqual(200);
    }
  });
});
