import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useSession } from "@acme/spa/hooks/use-session";

function isAuthRoute(pathname: string): boolean {
  const authRoutes = [
    "/auth/login",
    "/auth/register",
    "/auth/verify-email",
    "/auth/forgot-password",
    "/auth/reset-password",
  ];
  return authRoutes.some((route) => pathname.startsWith(route));
}

function isSpecialAuthRoute(pathname: string): boolean {
  const specialAuthRoutes = ["/auth/accept-invitation"];
  return specialAuthRoutes.some((route) => pathname.startsWith(route));
}

const redirectOrigin = "http://redirect.invalid";

/**
 * Keeps same-origin paths only. Prefix checks are not enough: browsers fold a leading `"/\"` or a
 * tab into `"//"`, so `/\evil.example` starts with a slash yet resolves to another origin. Only a
 * resolved URL tells the two apart. The dummy origin must stay `http:`/`https:`: backslash folding
 * only applies to special schemes.
 */
function sanitizeRedirectPath(redirectParam: string | null): string | null {
  if (!redirectParam?.startsWith("/")) return null;
  let resolved: URL;
  try {
    resolved = new URL(redirectParam, redirectOrigin);
  } catch {
    return null;
  }
  if (resolved.origin !== redirectOrigin) return null;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export function useAuthRedirect() {
  const { data: sessionData, isPending } = useSession();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (
      !isPending &&
      !sessionData &&
      !isAuthRoute(location.pathname) &&
      !isSpecialAuthRoute(location.pathname)
    ) {
      const redirectUrl = encodeURIComponent(location.pathname + location.search);
      navigate(`/auth/login?redirect=${redirectUrl}`);
    }

    if (
      !isPending &&
      sessionData &&
      isAuthRoute(location.pathname) &&
      !isSpecialAuthRoute(location.pathname)
    ) {
      const redirectParams = searchParams.get("redirect");
      const redirectPath = sanitizeRedirectPath(redirectParams);
      if (redirectPath) {
        navigate(redirectPath, { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    }
  }, [sessionData, navigate, isPending, location.pathname, location.search, searchParams]);
}
