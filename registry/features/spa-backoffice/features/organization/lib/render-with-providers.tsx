import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";

interface RenderWithProvidersOptions extends RenderOptions {
  initialEntries?: string[];
}

export function renderWithProviders(ui: ReactElement, options?: RenderWithProvidersOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const { initialEntries, ...renderOptions } = options ?? {};

  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
    renderOptions,
  );
}
