import { cn } from "@acme/ui/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Badge } from "./badge";
import type { BadgeProps } from "./badge";
import type { LucideIcon } from "lucide-react";

interface EntityBadge {
  label: string;
  variant?: BadgeProps["variant"];
  className?: string;
  icon?: LucideIcon;
}

interface EntityCardProps {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: LucideIcon | React.ReactNode;
  badges?: EntityBadge[];
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
  headerClassName?: string;
}

export function EntityCard({
  title,
  subtitle,
  description,
  icon: Icon,
  badges,
  footer,
  actions,
  onClick,
  href,
  className,
  headerClassName,
}: EntityCardProps) {
  const isClickable = !!onClick || !!href;

  const iconContent = Icon && (
    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
      {typeof Icon === "function" ? <Icon className="h-5 w-5 text-primary" /> : Icon}
    </div>
  );

  const cardContent = (
    <>
      <CardHeader className={cn("pb-3", headerClassName)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {iconContent}
            <div className="min-w-0 flex-1">
              <CardTitle
                className={cn(
                  "text-lg truncate",
                  isClickable && "group-hover:text-primary transition-colors",
                )}
              >
                {title}
              </CardTitle>
              {subtitle && <p className="text-sm text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>
          {(badges || actions) && (
            <div className="flex items-center gap-2 shrink-0">
              {badges?.map((badge, index) => (
                <Badge
                  key={index}
                  variant={badge.variant || "default"}
                  className={cn("flex items-center gap-1", badge.className)}
                >
                  {badge.icon && <badge.icon className="h-3 w-3" />}
                  {badge.label}
                </Badge>
              ))}
              {actions}
            </div>
          )}
        </div>
      </CardHeader>
      {(description || footer) && (
        <CardContent className="pb-3">
          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{description}</p>
          )}
          {footer}
        </CardContent>
      )}
    </>
  );

  const cardClassName = cn(
    "transition-shadow",
    isClickable && "hover:shadow-md cursor-pointer group",
    className,
  );

  if (href) {
    return (
      <a href={href} className={cardClassName}>
        <Card>{cardContent}</Card>
      </a>
    );
  }

  return (
    <Card className={cardClassName} onClick={onClick}>
      {cardContent}
    </Card>
  );
}
