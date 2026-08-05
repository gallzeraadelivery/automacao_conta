import { describe, expect, it } from "vitest";
import { bezierPoint, buildMousePath, mulberry32, randomSeed } from "./humanize";

describe("mulberry32", () => {
  it("é determinístico por seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("seeds diferentes divergem", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("buildMousePath", () => {
  it("termina no alvo e tem vários pontos", () => {
    const rng = mulberry32(99);
    const path = buildMousePath({ x: 10, y: 10 }, { x: 400, y: 300 }, rng);
    expect(path.length).toBeGreaterThanOrEqual(10);
    const last = path[path.length - 1]!;
    expect(last.x).toBeCloseTo(400, 0);
    expect(last.y).toBeCloseTo(300, 0);
  });

  it("paths com mesma seed são iguais; seeds diferentes não", () => {
    const p1 = buildMousePath({ x: 0, y: 0 }, { x: 100, y: 100 }, mulberry32(7));
    const p2 = buildMousePath({ x: 0, y: 0 }, { x: 100, y: 100 }, mulberry32(7));
    const p3 = buildMousePath({ x: 0, y: 0 }, { x: 100, y: 100 }, mulberry32(8));
    expect(p1).toEqual(p2);
    expect(p1[3]).not.toEqual(p3[3]);
  });
});

describe("bezierPoint", () => {
  it("t=0 e t=1 batem nas extremidades", () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 10, y: 10 };
    const c = { x: 5, y: 0 };
    expect(bezierPoint(0, p0, c, c, p3)).toEqual(p0);
    expect(bezierPoint(1, p0, c, c, p3)).toEqual(p3);
  });
});

describe("randomSeed", () => {
  it("retorna inteiro não-negativo", () => {
    const s = randomSeed();
    expect(s).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(s)).toBe(true);
  });
});
