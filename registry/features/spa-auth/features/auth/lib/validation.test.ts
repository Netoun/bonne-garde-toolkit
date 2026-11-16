import { describe, expect, it } from "vite-plus/test";
import { loginSchema, registerSchema, resetPasswordSchema } from "./validation";

describe("authentication form validation", () => {
  it("accepts a valid login", () => {
    expect(
      loginSchema.safeParse({ email: "user@example.com", password: "secret123" }).success,
    ).toBe(true);
  });

  it("rejects an invalid email and an empty password", () => {
    expect(loginSchema.safeParse({ email: "invalid", password: "" }).success).toBe(false);
  });

  it("requires matching passwords during registration", () => {
    const result = registerSchema.safeParse({
      name: "Test User",
      email: "user@example.com",
      password: "secret123",
      confirmPassword: "different",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.includes("confirmPassword"))).toBe(true);
  });

  it("rejects short passwords when resetting credentials", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "short", confirmPassword: "short" }).success,
    ).toBe(false);
  });
});
