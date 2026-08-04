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

  it("nome com uma palavra so: sobrenome fica placeholder Driver (Uber exige last name)", () => {
    expect(splitFullName("Madonna")).toEqual({ firstName: "Madonna", lastName: "Driver" });
    expect(splitFullName("galldelivery")).toEqual({ firstName: "galldelivery", lastName: "Driver" });
  });

  it("nome vazio: fallback administrativo", () => {
    expect(splitFullName("   ")).toEqual({ firstName: "Driver", lastName: "Partner" });
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

  it("sobrenome curto: completa com x até ≥ 8 caracteres (regra Uber)", () => {
    expect(buildPlaceholderPassword("Zeamalho Sa", "@2026")).toBe("Sax@2026");
    expect(buildPlaceholderPassword("Li", "@2026")).toBe("Lix@2026");
  });
});

describe("buildPlaceholderPhone", () => {
  it("gera número US a partir da base 5613256600", () => {
    expect(buildPlaceholderPhone("any", 0)).toBe("(561) 325-6600");
  });

  it("incrementa 01 02 03 nas tentativas seguintes", () => {
    expect(buildPlaceholderPhone("any", 1)).toBe("(561) 325-6601");
    expect(buildPlaceholderPhone("any", 2)).toBe("(561) 325-6602");
    expect(buildPlaceholderPhone("any", 3)).toBe("(561) 325-6603");
  });

  it("é estável para o mesmo attempt (independente do applicantId)", () => {
    expect(buildPlaceholderPhone("a", 0)).toBe(buildPlaceholderPhone("b", 0));
  });
});

describe("nextFreePlaceholderPhoneDigits", () => {
  it("começa na base quando nenhum número está bloqueado", async () => {
    const { nextFreePlaceholderPhoneDigits, formatUsPhoneFromDigits } = await import("./nameUtils");
    expect(formatUsPhoneFromDigits(nextFreePlaceholderPhoneDigits([]))).toBe("(561) 325-6600");
  });

  it("pula números já usados no hub", async () => {
    const { nextFreePlaceholderPhoneDigits, formatUsPhoneFromDigits } = await import("./nameUtils");
    expect(
      formatUsPhoneFromDigits(nextFreePlaceholderPhoneDigits(["5613256600", "5613256601"])),
    ).toBe("(561) 325-6602");
  });
});
