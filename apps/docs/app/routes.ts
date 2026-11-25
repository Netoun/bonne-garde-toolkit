import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("docs/guides/:slug", "routes/user-guide.tsx", { id: "user-guide" }),
  route("docs/:slug", "routes/guide.tsx", { id: "guide" }),
  route("docs/adr/:slug", "routes/guide.tsx", { id: "adr" }),
  route("components/:name", "routes/item.tsx", { id: "component" }),
  route("blocks/:name", "routes/item.tsx", { id: "block" }),
  route("modules/:category/:id", "routes/module.tsx"),
] satisfies RouteConfig;
