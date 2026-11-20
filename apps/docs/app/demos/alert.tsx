import { AlertCircle } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@acme/ui/components/alert";
import { Button } from "@acme/ui/components/button";

export default function AlertDemo() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <Alert>
        <AlertCircle />
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>You can add components to your app using the CLI.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Your session has expired. Please sign in again.</AlertDescription>
        <AlertAction>
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
