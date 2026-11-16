import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@acme/ui/components/button";
import { Link } from "react-router";

export interface PageAction {
  label: string;
  href?: string;
  icon?: LucideIcon;
  onClick?: () => void;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  backLink?: string;
  actions?: PageAction[];
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  backLink,
  actions = [],
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 w-full">
      <div className="flex items-center gap-3 min-w-0">
        {backLink && (
          <Button variant="outline" size="sm" asChild>
            <Link to={backLink}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden @sm:inline">Retour</span>
            </Link>
          </Button>
        )}
        {Icon && <Icon className="h-6 w-6 text-primary shrink-0" />}
        <h1 className="text-2xl font-bold tracking-tight truncate">{title}</h1>
      </div>
      {actions.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          {actions.map((action, index) =>
            action.href ? (
              <Button key={index} size="sm" asChild>
                <Link to={action.href}>
                  {action.icon && <action.icon className="h-4 w-4 mr-2" />}
                  {action.label}
                </Link>
              </Button>
            ) : (
              <Button key={index} variant="outline" size="sm" onClick={action.onClick}>
                {action.icon && <action.icon className="h-4 w-4 mr-2" />}
                {action.label}
              </Button>
            ),
          )}
        </div>
      )}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
