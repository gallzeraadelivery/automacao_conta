import { describe, it, expect } from "vitest";
import { validateApplicantImportRows } from "./applicantImport";

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    external_id: "DRV-001",
    full_name: "João da Silva",
    email: "joao@example.com",
    phone: "11999999999",
    city: "São Paulo",
    state: "SP",
    postal_code: "01000-000",
    vehicle_type: "sedan",
    ...overrides,
  };
}

describe("validateApplicantImportRows", () => {
  it("accepts a well-formed row", () => {
    const result = validateApplicantImportRows([validRow()]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(0);
  });

  it("rejects an invalid email format", () => {
    const result = validateApplicantImportRows([validRow({ email: "not-an-email" })]);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors.some((e) => e.field === "email")).toBe(true);
  });

  it("rejects rows with empty required fields", () => {
    const result = validateApplicantImportRows([
      validRow({ full_name: "" }),
      validRow({ external_id: "" }),
    ]);
    expect(result.invalidRows).toHaveLength(2);
  });

  it("flags duplicate email within the same file", () => {
    const result = validateApplicantImportRows([
      validRow({ external_id: "DRV-001", email: "dup@example.com" }),
      validRow({ external_id: "DRV-002", email: "dup@example.com" }),
    ]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]!.field).toBe("email");
  });

  it("flags duplicate external_id within the same file", () => {
    const result = validateApplicantImportRows([
      validRow({ external_id: "DRV-001", email: "a@example.com" }),
      validRow({ external_id: "DRV-001", email: "b@example.com" }),
    ]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]!.field).toBe("external_id");
  });

  it("treats email duplicates case-insensitively", () => {
    const result = validateApplicantImportRows([
      validRow({ external_id: "DRV-001", email: "Same@Example.com" }),
      validRow({ external_id: "DRV-002", email: "same@example.com" }),
    ]);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
  });

  it("rejects a malformed proxy_id (not a UUID)", () => {
    const result = validateApplicantImportRows([validRow({ proxy_id: "not-a-uuid" })]);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors.some((e) => e.field === "proxy_id")).toBe(true);
  });

  it("accepts a well-formed proxy_id", () => {
    const result = validateApplicantImportRows([
      validRow({ proxy_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }),
    ]);
    expect(result.validRows).toHaveLength(1);
  });

  it("rejects a state that is not 2 letters", () => {
    const result = validateApplicantImportRows([validRow({ state: "SPX" })]);
    expect(result.invalidRows).toHaveLength(1);
  });
});
