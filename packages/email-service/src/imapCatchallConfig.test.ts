import { describe, it, expect } from "vitest";
import { resolveCatchallInboxEmail } from "./imapCatchallConfig";

describe("resolveCatchallInboxEmail", () => {
  it("maps mail2too aliases to galldelivery inbox", () => {
    expect(resolveCatchallInboxEmail("gallsuper10@mail2too.com")).toBe(
      "galldelivery@mail2too.com",
    );
    expect(resolveCatchallInboxEmail("Anyone@Mail2Too.com")).toBe("galldelivery@mail2too.com");
  });

  it("returns null for the catch-all inbox itself", () => {
    expect(resolveCatchallInboxEmail("galldelivery@mail2too.com")).toBeNull();
  });

  it("returns null for unrelated domains", () => {
    expect(resolveCatchallInboxEmail("driver@gmail.com")).toBeNull();
  });
});
