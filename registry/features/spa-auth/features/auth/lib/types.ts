export interface AuthLayoutHandle {
  title?: string;
  subtitle?: string;
}

export function isAuthLayoutHandle(handle: unknown): handle is AuthLayoutHandle {
  return typeof handle === "object" && handle !== null;
}
