import { route, type RouteConfig } from "@react-router/dev/routes";

export default [
  route("auth", "features/auth/pages/auth-layout.tsx", [
    route("login", "features/auth/pages/auth-login-page.tsx"),
    route("register", "features/auth/pages/auth-register-page.tsx"),
    route("forgot-password", "features/auth/pages/auth-forgot-password-page.tsx"),
    route("reset-password", "features/auth/pages/auth-reset-password-page.tsx"),
    route("verify-email", "features/auth/pages/auth-verify-email-page.tsx"),
  ]),
] satisfies RouteConfig;
