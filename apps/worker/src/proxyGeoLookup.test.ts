import { describe, expect, it } from "vitest";
import { formatProxyGeoLabel } from "./proxyGeoLookup";

describe("formatProxyGeoLabel", () => {
  it("junta cidade e região", () => {
    expect(formatProxyGeoLabel("Miami", "Florida")).toBe("Miami, Florida");
  });

  it("aceita só cidade ou só região", () => {
    expect(formatProxyGeoLabel("Miami", null)).toBe("Miami");
    expect(formatProxyGeoLabel(null, "Florida")).toBe("Florida");
    expect(formatProxyGeoLabel(null, null)).toBeNull();
  });
});
