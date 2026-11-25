import { afterAll, afterEach, beforeAll, describe } from "vite-plus/test";
import { setupServer } from "msw/node";

export const server = setupServer();

describe.skip("organization MSW server", () => {});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
