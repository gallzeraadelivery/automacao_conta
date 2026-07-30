import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("serializes rows with a header line", () => {
    const csv = toCsv([{ a: "1", b: "2" }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n1,2");
  });

  it("escapes values containing commas, quotes and newlines (RFC 4180)", () => {
    const csv = toCsv([{ name: 'a "quoted", value\nwith newline' }], ["name"]);
    expect(csv).toBe('name\r\n"a ""quoted"", value\nwith newline"');
  });

  it("renders null/undefined as an empty cell", () => {
    const csv = toCsv([{ a: null, b: undefined }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n,");
  });

  it("serializes Date values as ISO strings", () => {
    const date = new Date("2024-01-15T10:30:00.000Z");
    const csv = toCsv([{ when: date }], ["when"]);
    expect(csv).toBe("when\r\n2024-01-15T10:30:00.000Z");
  });

  it("infers headers from the first row when none are given", () => {
    const csv = toCsv([{ x: "1", y: "2" }]);
    expect(csv).toBe("x,y\r\n1,2");
  });
});
