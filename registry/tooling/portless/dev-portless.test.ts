import { describe, expect, it } from "bun:test";
import { buildPortlessStack, needsProxyRestart, portlessNames } from "./dev-portless";

const NAMES = portlessNames("acme");
const URLS = {
  api: "https://api.acme.localhost",
  spa: "https://spa.acme.localhost",
  ssr: "https://ssr.acme.localhost",
  static: "https://acme.localhost",
};

describe("needsProxyRestart", () => {
  it("restarts a loopback proxy when LAN is requested", () => {
    expect(needsProxyRestart("https://acme.localhost", true)).toBe(true);
  });

  it("restarts a LAN proxy when loopback is requested", () => {
    expect(needsProxyRestart("https://acme.local", false)).toBe(true);
  });

  it("keeps a proxy already in the requested mode", () => {
    expect(needsProxyRestart("https://acme.local", true)).toBe(false);
    expect(needsProxyRestart("https://acme.localhost", false)).toBe(false);
  });
});

describe("portlessNames", () => {
  it("gives each app its own subdomain and puts static on the apex", () => {
    expect(portlessNames("acme")).toEqual({
      static: "acme",
      spa: "spa.acme",
      ssr: "ssr.acme",
      api: "api.acme",
    });
  });
});

describe("buildPortlessStack", () => {
  const stack = buildPortlessStack(NAMES, URLS);
  const app = (key: string) => stack.find((entry) => entry.key === key)!;

  it("starts one process per app", () => {
    expect(stack.map((entry) => entry.key)).toEqual(["api", "spa", "ssr", "static"]);
  });

  it("hands wrangler the free port portless assigns and injects the public URLs", () => {
    expect(app("api").cmd).toEqual([
      "portless",
      "run",
      "--name",
      "api.acme",
      "sh",
      "-c",
      'exec bunx wrangler dev --port "$PORT" "$@"',
      "wrangler",
      "--var",
      "API_URL:https://api.acme.localhost",
      "--var",
      "R2_PUBLIC_URL:https://api.acme.localhost/v1/media/file",
      "--var",
      "SPA_URL:https://spa.acme.localhost",
      "--var",
      "SSR_URL:https://ssr.acme.localhost",
    ]);
  });

  it("runs the fronts through a runner portless recognises, so it injects a free port", () => {
    expect(app("spa").cmd).toEqual([
      "portless",
      "run",
      "--name",
      "spa.acme",
      "bunx",
      "react-router",
      "dev",
    ]);
    expect(app("ssr").cmd).toEqual([
      "portless",
      "run",
      "--name",
      "ssr.acme",
      "bunx",
      "react-router",
      "dev",
    ]);
    expect(app("static").cmd).toEqual([
      "portless",
      "run",
      "--name",
      "acme",
      "bunx",
      "react-router",
      "dev",
    ]);
  });

  it("points every front at the proxied siblings", () => {
    expect(app("spa").env).toEqual({ VITE_API_URL: URLS.api });
    expect(app("ssr").env).toEqual({ API_URL: URLS.api });
    expect(app("static").env).toEqual({
      VITE_APP_URL: URLS.spa,
      VITE_API_URL: URLS.api,
    });
  });

  it("runs each app from its own workspace directory", () => {
    expect(stack.map((entry) => entry.cwd)).toEqual([
      "apps/api",
      "apps/spa",
      "apps/ssr",
      "apps/static",
    ]);
  });
});
