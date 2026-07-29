import { describe, it, expect } from "vitest";
import { maskCode, maskEmail, maskPhone } from "./masking";

describe("maskCode", () => {
  it("keeps only the last 2 characters visible", () => {
    expect(maskCode("482913")).toBe("****13");
  });

  it("handles short codes", () => {
    expect(maskCode("5")).toBe("****5");
  });

  it("handles empty input safely", () => {
    expect(maskCode("")).toBe("****");
  });
});

describe("maskEmail", () => {
  it("keeps only the first letter and the domain", () => {
    expect(maskEmail("joao.silva@gmail.com")).toBe("j***@gmail.com");
  });

  it("handles malformed input without throwing", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });
});

describe("maskPhone", () => {
  it("keeps only the last 4 digits", () => {
    expect(maskPhone("11999998888")).toBe("****8888");
  });

  it("strips formatting before masking", () => {
    expect(maskPhone("(11) 99999-8888")).toBe("****8888");
  });

  it("handles too-short input safely", () => {
    expect(maskPhone("12")).toBe("****");
  });
});
