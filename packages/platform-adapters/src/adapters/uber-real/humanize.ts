import type { Locator, Page } from "playwright";

/**
 * Interação humanizada: trajetória de mouse + delays variáveis por sessão.
 * Seed diferente a cada run → ritmo/paths não ficam idênticos entre tentativas.
 */

export type Rng = () => number; // [0, 1)

/** PRNG Mulberry32 — determinístico por seed (testável). */
export function mulberry32(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface Point {
  x: number;
  y: number;
}

/** Curva cúbica de Bézier (P0→P3) com controles P1/P2. */
export function bezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/** Gera pontos intermediários com jitter leve (não linha reta). */
export function buildMousePath(from: Point, to: Point, rng: Rng, steps?: number): Point[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const n = steps ?? clamp(Math.floor(8 + dist / 25 + rng() * 10), 10, 36);

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const offset = clamp(dist * (0.15 + rng() * 0.35), 20, 140);
  const angle = Math.atan2(to.y - from.y, to.x - from.x) + (rng() > 0.5 ? 1 : -1) * (Math.PI / 2);
  const c1: Point = {
    x: from.x + (to.x - from.x) * (0.2 + rng() * 0.25) + Math.cos(angle) * offset * (0.3 + rng() * 0.4),
    y: from.y + (to.y - from.y) * (0.2 + rng() * 0.25) + Math.sin(angle) * offset * (0.3 + rng() * 0.4),
  };
  const c2: Point = {
    x: midX + Math.cos(angle) * offset * (rng() - 0.5),
    y: midY + Math.sin(angle) * offset * (rng() - 0.5),
  };

  const path: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // ease-in-out suave
    const te = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const p = bezierPoint(te, from, c1, c2, to);
    path.push({
      x: p.x + (rng() - 0.5) * 1.2,
      y: p.y + (rng() - 0.5) * 1.2,
    });
  }
  path[path.length - 1] = { ...to };
  return path;
}

export interface HumanClickOptions {
  timeout?: number;
  force?: boolean;
  noWaitAfter?: boolean;
  /** Offset aleatório dentro do bounding box (default true). */
  jitterInside?: boolean;
}

export interface HumanTypeOptions {
  timeout?: number;
  /** Limpa o campo antes (Triple-click / select-all). */
  clear?: boolean;
  /** Delay base por tecla; real = base ± jitter. */
  delayMs?: { min: number; max: number };
}

/**
 * Fachada por página/sessão. Uma instância por run do adaptador.
 */
export class HumanInteraction {
  private lastPos: Point = { x: 40 + Math.random() * 80, y: 60 + Math.random() * 80 };
  readonly seed: number;

  constructor(
    private readonly page: Page,
    private readonly rng: Rng,
    seed: number,
  ) {
    this.seed = seed;
  }

  static forPage(page: Page, seed = randomSeed()): HumanInteraction {
    return new HumanInteraction(page, mulberry32(seed), seed);
  }

  /** Número em [min, max]. */
  between(min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + this.rng() * (hi - lo);
  }

  async pause(minMs: number, maxMs: number): Promise<void> {
    const ms = Math.round(this.between(minMs, maxMs));
    if (ms > 0) await this.page.waitForTimeout(ms);
  }

  /** Pausa “pensar” entre etapas (mais longa, variável). */
  async think(): Promise<void> {
    await this.pause(280, 1_100);
  }

  /** Pausa curta entre micro-ações. */
  async micro(): Promise<void> {
    await this.pause(60, 280);
  }

  async moveTo(target: Point): Promise<void> {
    const path = buildMousePath(this.lastPos, target, this.rng);
    for (const p of path) {
      await this.page.mouse.move(p.x, p.y);
      await this.page.waitForTimeout(Math.round(this.between(4, 18)));
    }
    this.lastPos = { ...target };
  }

  private async targetPoint(locator: Locator, jitterInside: boolean): Promise<Point> {
    const box = await locator.boundingBox();
    if (!box) {
      // Fallback: centro da viewport
      const vp = this.page.viewportSize() ?? { width: 1280, height: 800 };
      return { x: vp.width / 2, y: vp.height / 2 };
    }
    const padX = jitterInside ? box.width * (0.15 + this.rng() * 0.7) : box.width / 2;
    const padY = jitterInside ? box.height * (0.2 + this.rng() * 0.6) : box.height / 2;
    return {
      x: box.x + clamp(padX, 2, Math.max(2, box.width - 2)),
      y: box.y + clamp(padY, 2, Math.max(2, box.height - 2)),
    };
  }

  /**
   * Move o mouse até o elemento e clica (botão esquerdo).
   * Preferir isto a `locator.click()` direto.
   */
  async click(locator: Locator, options: HumanClickOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 15_000;
    await locator.waitFor({ state: "visible", timeout });
    await this.think();
    const point = await this.targetPoint(locator, options.jitterInside !== false);
    await this.moveTo(point);
    await this.micro();
    await this.page.mouse.down();
    await this.pause(35, 120);
    await this.page.mouse.up();
    if (!options.noWaitAfter) {
      await this.micro();
    }
  }

  /**
   * Clique com fallback `locator.click` se o mouse falhar (elemento fora/overlay).
   */
  async clickSafe(locator: Locator, options: HumanClickOptions = {}): Promise<void> {
    try {
      await this.click(locator, options);
    } catch {
      await locator.click({
        timeout: options.timeout,
        force: options.force,
        noWaitAfter: options.noWaitAfter,
      });
      await this.micro();
    }
  }

  /** Foca o campo e digita caractere a caractere com delay variável. */
  async type(locator: Locator, text: string, options: HumanTypeOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 15_000;
    const delayRange = options.delayMs ?? { min: 45, max: 160 };
    await locator.waitFor({ state: "visible", timeout });
    await this.clickSafe(locator, { timeout });
    if (options.clear !== false) {
      // Chromium (Playwright) responde bem a Control+A em macOS/Linux.
      await this.page.keyboard.press("Control+A");
      await this.micro();
      await this.page.keyboard.press("Backspace");
      await this.micro();
    }
    for (const ch of text) {
      await this.page.keyboard.type(ch, {
        delay: Math.round(this.between(delayRange.min, delayRange.max)),
      });
      // Pausas ocasionais “releitura”
      if (this.rng() < 0.08) await this.pause(120, 420);
    }
    await this.micro();
  }

  /** Digita sequência OTP (rápido o bastante pro auto-avanço, ainda variável). */
  async typeOtp(code: string): Promise<void> {
    for (const ch of code) {
      await this.page.keyboard.type(ch, {
        delay: Math.round(this.between(55, 140)),
      });
    }
    await this.micro();
  }
}
