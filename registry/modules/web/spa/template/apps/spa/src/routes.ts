import { index, type RouteConfig, type RouteConfigEntry } from "@react-router/dev/routes";

// A feature declares its own routes in `features/<feature>/routes.ts`: a default export of route
// entries, with paths relative to `src`. Every fragment found is composed here, so adding a feature
// that ships one adds its pages and leaves this file as it is.
const fragments = import.meta.glob<{ default: RouteConfigEntry[] }>("./features/*/routes.ts", {
  eager: true,
});

const features = Object.values(fragments).flatMap((fragment) => fragment.default);

// The shell's home page is the index route until a feature declares its own, which replaces it.
export default (features.some((entry) => entry.index === true)
  ? features
  : [index("features/home/pages/home-page.tsx"), ...features]) satisfies RouteConfig;
