import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logoFiles, logoPath } from "./gen-logo";

it("keeps assets/logo/ equal to what gen:logo writes", () => {
  for (const [name, content] of Object.entries(logoFiles())) {
    expect(readFileSync(join(import.meta.dir, "../assets/logo", name), "utf8")).toBe(content);
  }
});

it("draws the logo as one closed outline", () => {
  const path = logoPath();
  expect(path.match(/M/g)).toHaveLength(1);
  expect(path.endsWith("Z")).toBe(true);
  expect(path).not.toContain("NaN");
});
