import { describe, expect, it } from "vitest";
import { buildPlaceholderPassword, buildPlaceholderPhone, splitFullName } from "./nameUtils";

describe("splitFullName", () => {
  it("divide nome simples em nome/sobrenome", () => {
    expect(splitFullName("João Silva")).toEqual({ firstName: "João", lastName: "Silva" });
  });

  it("nomes com mais de duas palavras: ultima palavra vira sobrenome", () => {
    expect(splitFullName("João Pedro da Silva")).toEqual({
      firstName: "João Pedro da",
      lastName: "Silva",
    });
  });

  it("nome com uma palavra so: sobrenome fica vazio", () => {
    expect(splitFullName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });

  it("normaliza espacos extras", () => {
    expect(splitFullName("  João   Silva  ")).toEqual({ firstName: "João", lastName: "Silva" });
  });
});

describe("buildPlaceholderPassword", () => {
  it("usa o sobrenome capitalizado + sufixo", () => {
    expect(buildPlaceholderPassword("João Silva", "@2026")).toBe("Silva@2026");
  });

  it("normaliza capitalizacao (sobrenome em caixa alta/baixa)", () => {
    expect(buildPlaceholderPassword("Maria DA COSTA", "@2026")).toBe("Costa@2026");
  });

  it("nome com uma palavra so: usa o proprio nome", () => {
    expect(buildPlaceholderPassword("Madonna", "@2026")).toBe("Madonna@2026");
  });
});

describe("buildPlaceholderPhone", () => {
  it("gera numero no formato US com prefixo fictício 555-01", () => {
    const phone = buildPlaceholderPhone("11111111-1111-1111-1111-111111111111");
    expect(phone).toMatch(/^\(201\) 555-01\d{2}$/);
  });

  it("é determinístico para o mesmo applicantId", () => {
    const a = buildPlaceholderPhone("applicant-a");
    const b = buildPlaceholderPhone("applicant-a");
    expect(a).toBe(b);
  });

  it("varia entre applicantIds diferentes (reduz colisão em lote)", () => {
    const a = buildPlaceholderPhone("applicant-a");
    const b = buildPlaceholderPhone("applicant-b");
    expect(a).not.toBe(b);
  });
});
