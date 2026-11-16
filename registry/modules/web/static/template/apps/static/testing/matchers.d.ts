import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vite-plus/test" {
  interface Assertion<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
}
