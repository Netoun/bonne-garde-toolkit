import { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { authClient } from "@acme/spa/features/auth/lib/auth";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { Alert, AlertDescription } from "@acme/ui/components/alert";
import { Loader2 } from "lucide-react";

export default function AuthVerifyEmail() {
  const [searchParams] = useSearchParams();
  const tokenRef = useRef<string | null>(searchParams.get("token"));
  const token = tokenRef.current;
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const hasVerified = useRef(false);

  useEffect(() => {
    if (!searchParams.has("token")) return;
    const cleanParams = new URLSearchParams(searchParams);
    cleanParams.delete("token");
    const nextSearch = cleanParams.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
  }, [location.pathname, navigate, searchParams]);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("Missing verification token.");
      return;
    }

    // Prevent double verification in React Strict Mode
    if (hasVerified.current) return;
    hasVerified.current = true;

    const verifyEmail = async () => {
      try {
        const { error } = await authClient.verifyEmail({ query: { token } });

        if (error) {
          setStatus("error");
          setErrorMessage(error.message || "Verification error");
        } else {
          setStatus("success");
        }
      } catch {
        setStatus("error");
        setErrorMessage("Network error. Please try again.");
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold">Email Verification</h2>
      </div>

      {status === "loading" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verifying...</p>
        </div>
      )}

      {status === "success" && (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>Your email has been verified successfully!</AlertDescription>
          </Alert>
          <Link
            to="/auth/login"
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            Sign in
          </Link>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
          <Link
            to="/auth/login"
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            Back to sign in
          </Link>
        </div>
      )}
    </div>
  );
}
