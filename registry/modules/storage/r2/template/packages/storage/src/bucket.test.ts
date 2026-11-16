import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Miniflare } from "miniflare";
import { R2_BINDING, bindR2, readR2 } from "./bucket";

// A real R2 bucket, which is what Miniflare runs workerd's for: no stand-in, no mock.
const miniflare = new Miniflare({
  modules: true,
  script: "export default {}",
  r2Buckets: { [R2_BINDING]: "r2-test" },
});
let r2: Awaited<ReturnType<Miniflare["getR2Bucket"]>>;

beforeAll(async () => {
  r2 = await miniflare.getR2Bucket(R2_BINDING);
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("bindR2", () => {
  it("returns the binding the environment holds, and it stores and serves objects", async () => {
    const bucket = bindR2({ [R2_BINDING]: r2 });

    await bucket?.put("medias/a.txt", "first", { httpMetadata: { contentType: "text/plain" } });
    const object = await bucket?.get("medias/a.txt");

    expect(Object.is(bucket, r2)).toBe(true);
    expect(await object?.text()).toBe("first");
    expect(object?.httpMetadata?.contentType).toBe("text/plain");
  });

  it("returns undefined when the environment has no binding, so the service can say so", () => {
    expect(bindR2({})).toBeUndefined();
  });

  it("does not take an environment variable of the same name for the binding", () => {
    expect(bindR2({ [R2_BINDING]: "a string" })).toBeUndefined();
    expect(bindR2({ [R2_BINDING]: null })).toBeUndefined();
  });
});

describe("readR2", () => {
  it("is undefined where the runtime provides no binding, as under bun test", async () => {
    expect(await readR2()).toBeUndefined();
  });
});
