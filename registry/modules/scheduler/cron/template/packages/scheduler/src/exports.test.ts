import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vite-plus/test";
import * as driver from "./driver.node";
import * as scheduler from "./index";

afterAll(() => driver.stopScheduler());

describe("the exports of the package", () => {
  it("`.` exports defineSchedule and nothing else that runs code on a timer", () => {
    expect(Object.keys(scheduler).sort()).toEqual(["defineSchedule"]);
  });

  it("`./driver` exports stopScheduler and nothing else", () => {
    expect(Object.keys(driver).sort()).toEqual(["stopScheduler"]);
  });

  it("the package maps `.` and `./driver`, and no croner", async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const exportsMap =
      typeof manifest === "object" && manifest !== null && "exports" in manifest
        ? manifest.exports
        : null;

    expect(Object.keys(exportsMap ?? {}).sort()).toEqual([".", "./driver"]);
  });
});
