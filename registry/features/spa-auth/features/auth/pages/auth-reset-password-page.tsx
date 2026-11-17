import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link, useLocation } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@acme/spa/features/auth/lib/auth";
import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";
import { Label } from "@acme/ui/components/label";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { Alert, AlertDescription } from "@acme/ui/components/alert";
import { resetPasswordSchema, type ResetPasswordSchema } from "../lib/validation";

export default function AuthResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tokenRef = useRef<string | null>(searchParams.get("token"));
  const token = tokenRef.current;
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordSchema>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    if (!token) {
      setError("Missing or invalid reset token.");
    }
  }, [token]);

  useEffect(() => {
    if (!searchParams.has("token")) return;
    const cleanParams = new URLSearchParams(searchParams);
    cleanParams.delete("token");
    const nextSearch = cleanParams.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
  }, [location.pathname, navigate, searchParams]);

  const onSubmit = async (data: ResetPasswordSchema) => {
    if (!token) return;

    setError("");
    setSuccess(false);

    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: data.password,
        token,
      });

      if (resetError) {
        setError(resetError.message || "Reset error");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        navigate("/auth/login");
      }, 2000);
    } catch {
      setError("Network error. Please try again.");
    }
  };

  if (success) {
    return (
      <div className="w-full space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold">Password reset</h2>
        </div>
        <Alert>
          <AlertDescription>
            Your password has been reset successfully. Redirecting to sign in...
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold">Reset your password</h2>
        <p className="text-muted-foreground">Choose a new password</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            {...register("password")}
            disabled={isSubmitting || !token}
          />
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            {...register("confirmPassword")}
            disabled={isSubmitting || !token}
          />
          {errors.confirmPassword && (
            <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting || !token}>
          {isSubmitting ? "Resetting..." : "Reset password"}
        </Button>

        <div className="text-center text-sm">
          <Link to="/auth/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
