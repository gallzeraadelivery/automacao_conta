import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("allocateNextEarnCity", () => {
  it("sempre retorna Orlando, FL", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "earn-city-"));
    const file = path.join(dir, "rotation.json");
    await writeFile(file, JSON.stringify({ nextIndex: 0 }), "utf8");
    process.env.UBER_EARN_CITY_POOL_PATH = file;

    const { allocateNextEarnCity, EARN_CITY_FIXED } = await import("./earnCityPool");
    expect(await allocateNextEarnCity("a")).toBe(EARN_CITY_FIXED);
    expect(await allocateNextEarnCity("b")).toBe("Orlando, FL");
    expect(await allocateNextEarnCity("c")).toBe("Orlando, FL");
  });
});
