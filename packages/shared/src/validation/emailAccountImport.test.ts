import { describe, it, expect } from "vitest";
import { validateEmailAccountImportRows } from "./emailAccountImport";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    applicant_external_id: "DRV-001",
    email_address: "joao@gmail.com",
    password: "s3cr3t-password",
    ...overrides,
  };
}

describe("validateEmailAccountImportRows", () => {
  it("accepts a well-formed row", () => {
    const result = validateEmailAccountImportRows([validRow()]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(0);
  });

  it("rejects an invalid email_address format", () => {
    const result = validateEmailAccountImportRows([validRow({ email_address: "invalid" })]);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors.some((e) => e.field === "email_address")).toBe(true);
  });

  it("rejects a missing password", () => {
    const result = validateEmailAccountImportRows([validRow({ password: "" })]);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors.some((e) => e.field === "password")).toBe(true);
  });

  it("rejects a missing applicant_external_id", () => {
    const result = validateEmailAccountImportRows([validRow({ applicant_external_id: "" })]);
    expect(result.invalidRows).toHaveLength(1);
  });

  it("flags duplicate applicant_external_id within the same file", () => {
    const result = validateEmailAccountImportRows([
      validRow({ applicant_external_id: "DRV-001", email_address: "a@gmail.com" }),
      validRow({ applicant_external_id: "DRV-001", email_address: "b@gmail.com" }),
    ]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]!.field).toBe("applicant_external_id");
  });

  it("flags duplicate email_address within the same file", () => {
    const result = validateEmailAccountImportRows([
      validRow({ applicant_external_id: "DRV-001", email_address: "dup@gmail.com" }),
      validRow({ applicant_external_id: "DRV-002", email_address: "dup@gmail.com" }),
    ]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]!.field).toBe("email_address");
  });

  it("defaults provider to gmail when omitted", () => {
    const result = validateEmailAccountImportRows([validRow()]);
    expect(result.validRows[0]!.data.provider).toBe("gmail");
  });

  it("respects an explicit provider", () => {
    const result = validateEmailAccountImportRows([validRow({ provider: "outlook" })]);
    expect(result.validRows[0]!.data.provider).toBe("outlook");
  });
});
