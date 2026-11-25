import { http, HttpResponse } from "msw";
import { expect, it } from "vite-plus/test";
import { server } from "../../testing/server";
import { api } from "./api";

it("reaches VITE_API_URL through Eden and reads the response of an MSW handler", async () => {
  server.use(
    http.get(`${import.meta.env.VITE_API_URL}/health`, () =>
      HttpResponse.json({ status: "ok", timestamp: 1 }),
    ),
  );
  const { data, error } = await api.health.get();
  expect(error).toBeNull();
  expect(data).toMatchObject({ status: "ok" });
});
