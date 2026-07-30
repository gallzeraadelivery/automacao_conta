import { describe, expect, it } from "vitest";
import { extractNameFromLocalPart, validateEmailListRows } from "./emailListImport";

describe("extractNameFromLocalPart", () => {
  it.each([
    ["VikkiCuppctt2m", "Vikki", "Cuppctt"],
    ["TrixCordova6o365", "Trix", "Cordova"],
    ["AerielSchneider06a5b", "Aeriel", "Schneider"],
    ["AurieStephensons12ik", "Aurie", "Stephensons"],
    ["CaitlinBushe68b3", "Caitlin", "Bushe"],
    ["KaylaTorres1ubd6", "Kayla", "Torres"],
    ["LurleenHager53jlb", "Lurleen", "Hager"],
    ["DeenaPoston9gs2p", "Deena", "Poston"],
    ["RosettaWeber6bq4y", "Rosetta", "Weber"],
  ])("extrai nome/sobrenome de %s", (localPart, firstName, lastName) => {
    expect(extractNameFromLocalPart(localPart)).toEqual({ firstName, lastName });
  });

  it("sufixo sem digito gruda no sobrenome (limitacao conhecida, best-effort)", () => {
    expect(extractNameFromLocalPart("PhillieCloughyyvuo")).toEqual({
      firstName: "Phillie",
      lastName: "Cloughyyvuo",
    });
  });

  it("local-part sem padrao CamelCase reconhecivel: usa fallback", () => {
    expect(extractNameFromLocalPart("motorista123")).toEqual({
      firstName: "motorista",
      lastName: "",
    });
  });
});

describe("validateEmailListRows", () => {
  const sample = [
    "VikkiCuppctt2m@colsced.us|Phat3479",
    "TrixCordova6o365@colsced.us|Phat3479",
  ].join("\n");

  it("faz o parse de linhas validas", () => {
    const result = validateEmailListRows(sample);
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows).toEqual([
      {
        row: 1,
        data: {
          externalId: "vikkicuppctt2m",
          email: "vikkicuppctt2m@colsced.us",
          password: "Phat3479",
          firstName: "Vikki",
          lastName: "Cuppctt",
        },
      },
      {
        row: 2,
        data: {
          externalId: "trixcordova6o365",
          email: "trixcordova6o365@colsced.us",
          password: "Phat3479",
          firstName: "Trix",
          lastName: "Cordova",
        },
      },
    ]);
  });

  it("ignora linhas em branco", () => {
    const result = validateEmailListRows("\n" + sample + "\n\n");
    expect(result.validRows).toHaveLength(2);
  });

  it("rejeita linha sem separador |", () => {
    const result = validateEmailListRows("email-sem-senha@colsced.us");
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]!.message).toMatch(/email\|senha/);
  });

  it("rejeita email invalido", () => {
    const result = validateEmailListRows("nao-e-email|senha123");
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]!.field).toBe("email");
  });

  it("rejeita senha vazia", () => {
    const result = validateEmailListRows("valido@colsced.us|");
    expect(result.invalidRows).toHaveLength(1);
  });

  it("detecta email duplicado no proprio texto colado", () => {
    const result = validateEmailListRows(
      "dup@colsced.us|senha1\ndup@colsced.us|senha2",
    );
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]!.errors[0]!.message).toMatch(/duplicado/);
  });

  it("nunca inclui a senha em texto puro numa linha invalida", () => {
    const result = validateEmailListRows("nao-e-email|senha-secreta-123");
    expect(JSON.stringify(result.invalidRows)).not.toContain("senha-secreta-123");
  });
});
