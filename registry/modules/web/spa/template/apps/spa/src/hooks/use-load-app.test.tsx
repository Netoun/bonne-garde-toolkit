import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import useLoadApp from "./use-load-app";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// React runs an effect twice in development under StrictMode, its cleanup in between: the content
// shows all the same, where it once kept the loader up for good.
it("shows the content once the app has loaded, under StrictMode too", () => {
  const { result } = renderHook(() => useLoadApp(false), { wrapper: StrictMode });
  expect(result.current.shouldShowLoader).toBe(true);

  act(() => {
    vi.advanceTimersByTime(1_000);
  });

  expect(result.current).toMatchObject({
    showContent: true,
    contentOpacity: 1,
    shouldShowLoader: false,
  });
});
