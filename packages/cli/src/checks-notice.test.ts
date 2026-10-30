import { describe, expect, test } from "bun:test";
import { checksNotice } from "./checks-notice";

const api = { key: "api/elysia", checks: ["cd apps/api && bun run typecheck"] };

describe("checksNotice (050 step 15)", () => {
  test("says nothing when no module declares a check", () => {
    expect(checksNotice([{ key: "provider/cloudflare", checks: [] }], 0)).toBeNull();
    expect(checksNotice([], 3)).toBeNull();
  });

  test("withholds the checks while an intention is pending, naming them as its Validation", () => {
    const notice = checksNotice([api], 2);

    expect(notice).toContain("checks withheld while 2 intentions are pending");
    expect(notice).toContain("api/elysia: cd apps/api && bun run typecheck");
    expect(notice).not.toContain("were not run");
    expect(checksNotice([api], 1)).toContain("while 1 intention is pending");
  });

  test("says they were not run, with nothing pending, because add does not run them yet", () => {
    expect(checksNotice([api], 0)).toContain("checks were not run (spec 050 step 15");
  });
});
