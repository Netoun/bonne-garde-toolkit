import { describe, it, expect } from "bun:test";
import { config } from "{{SCOPE}}/api/lib/app.config";
import { allowedOrigins, applyCorsHeaders, originAllowed } from "./origins";

const EVIL_ORIGIN = "https://evil.example";

function requestFrom(origin?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("http://api.test/auth/session", { headers });
}

describe("allowedOrigins", () => {
  it("returns the configured SPA and SSR urls", () => {
    expect(allowedOrigins()).toEqual([config.SPA_URL, config.SSR_URL]);
  });

  it("reads from the env it is given and drops empty entries", () => {
    expect(allowedOrigins({ SPA_URL: "https://spa.example", SSR_URL: "" })).toEqual([
      "https://spa.example",
    ]);
  });
});

describe("originAllowed", () => {
  it("allows the SPA origin", () => {
    expect(originAllowed(config.SPA_URL)).toBe(true);
  });

  it("allows the SSR origin", () => {
    expect(originAllowed(config.SSR_URL)).toBe(true);
  });

  it("rejects an origin that is not configured", () => {
    expect(originAllowed(EVIL_ORIGIN)).toBe(false);
  });

  it("rejects the same host on another port or scheme", () => {
    const spa = new URL(config.SPA_URL);
    const otherPort = new URL(spa);
    otherPort.port = "5199";
    const otherScheme = new URL(spa);
    otherScheme.protocol = spa.protocol === "https:" ? "http:" : "https:";

    expect(originAllowed(otherPort.origin)).toBe(false);
    expect(originAllowed(otherScheme.origin)).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(originAllowed(`${new URL(config.SPA_URL).origin}/`)).toBe(true);
  });

  it("ignores the case of scheme and host", () => {
    expect(originAllowed(config.SPA_URL.toUpperCase())).toBe(true);
  });

  it("rejects an unparseable origin instead of throwing", () => {
    expect(originAllowed("not a url")).toBe(false);
    expect(originAllowed("null")).toBe(false);
  });

  it("rejects an opaque origin", () => {
    expect(originAllowed("file:///tmp/index.html")).toBe(false);
  });

  it("rejects an empty origin", () => {
    expect(originAllowed("")).toBe(false);
  });

  it("still allows valid origins when another configured url is malformed", () => {
    const previous = config.SPA_URL;
    config.SPA_URL = "not a url";
    try {
      expect(originAllowed(config.SSR_URL)).toBe(true);
      expect(originAllowed(EVIL_ORIGIN)).toBe(false);
    } finally {
      config.SPA_URL = previous;
    }
  });
});

describe("applyCorsHeaders", () => {
  it("returns a disallowed origin's response untouched", () => {
    const response = new Response("body", { status: 200 });

    const result = applyCorsHeaders(requestFrom(EVIL_ORIGIN), response);

    expect(result).toBe(response);
    expect(result.headers.has("access-control-allow-origin")).toBe(false);
    expect(result.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it("returns the response untouched when the request has no Origin header", () => {
    const response = new Response("body", { status: 200 });

    expect(applyCorsHeaders(requestFrom(), response)).toBe(response);
  });

  it("sets CORS headers for an allowed origin and keeps the rest of the response", async () => {
    const response = new Response("body", { status: 201, headers: { "x-keep": "1" } });

    const result = applyCorsHeaders(requestFrom(config.SPA_URL), response);

    expect(result.headers.get("access-control-allow-origin")).toBe(config.SPA_URL);
    expect(result.headers.get("access-control-allow-credentials")).toBe("true");
    expect(result.headers.get("access-control-allow-methods")).toContain("POST");
    expect(result.headers.get("access-control-allow-headers")).toContain("Content-Type");
    expect(result.status).toBe(201);
    expect(result.headers.get("x-keep")).toBe("1");
    expect(await result.text()).toBe("body");
  });

  it("handles a bodiless preflight response", () => {
    const result = applyCorsHeaders(
      requestFrom(config.SSR_URL),
      new Response(null, { status: 204 }),
    );

    expect(result.status).toBe(204);
    expect(result.headers.get("access-control-allow-origin")).toBe(config.SSR_URL);
  });

  it("echoes the request's Origin header as sent", () => {
    const sent = `${new URL(config.SPA_URL).origin}/`;

    const result = applyCorsHeaders(requestFrom(sent), new Response(null, { status: 204 }));

    expect(result.headers.get("access-control-allow-origin")).toBe(sent);
  });
});
