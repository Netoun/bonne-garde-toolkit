import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, EllipsisVertical } from "lucide-react";
import type React from "react";
import { Badge } from "@acme/ui/components/badge";
import { Button } from "@acme/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/components/dropdown-menu";

export interface EntityStat {
  icon: LucideIcon;
  label: string;
  value: number | string;
}

export interface EntityBadge {
  variant: "default" | "secondary" | "outline" | "destructive";
  label: string;
}

export interface EntityAction {
  icon?: LucideIcon;
  label: string;
  type: "link" | "button";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost" | "link" | "destructive";
}

interface EntityDetailHeaderProps {
  entity: { name: string; slug: string };
  icon?: LucideIcon;
  avatar?: React.ReactNode;
  backLink: string;
  stats?: EntityStat[];
  badges?: EntityBadge[];
  mobileDropdownItems?: EntityAction[];
  desktopActions?: EntityAction[];
}

export function EntityDetailHeader({
  entity,
  icon: Icon,
  avatar,
  backLink,
  stats = [],
  badges = [],
  mobileDropdownItems = [],
  desktopActions = [],
}: EntityDetailHeaderProps) {
  const hasDropdown = mobileDropdownItems.length > 0;
  const hasDesktopActions = desktopActions.length > 0;

  return (
    <div className="@container flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to={backLink}>
            <ArrowLeft className="h-4 w-4 @sm:mr-2" />
            <span className="hidden @sm:inline">Retour</span>
          </Link>
        </Button>
        <h1 className="text-lg font-bold flex items-center gap-2 truncate">
          {avatar ?? (Icon && <Icon className="h-5 w-5 text-primary shrink-0" />)}
          <span className="truncate">{entity.name}</span>
        </h1>
        <div className="hidden @2xl:flex items-center gap-3 text-sm text-muted-foreground">
          {stats.map((stat, index) => (
            <span key={index} className="flex items-center gap-1">
              <stat.icon className="h-4 w-4" />
              {stat.value} {stat.label}
            </span>
          ))}
          {badges.map((badge, index) => (
            <Badge key={index} variant={badge.variant} className="text-xs">
              {badge.label}
            </Badge>
          ))}
        </div>
        {hasDropdown && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="@5xl:hidden shrink-0 ml-auto">
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {mobileDropdownItems.map((item, index) =>
                item.type === "link" && item.href ? (
                  <DropdownMenuItem
                    key={index}
                    onSelect={() => item.href && (window.location.href = item.href)}
                    className="flex items-center"
                  >
                    {item.icon && <item.icon className="h-4 w-4 mr-2" />}
                    {item.label}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={index}
                    onClick={item.onClick}
                    disabled={item.disabled}
                    className="flex items-center"
                  >
                    {item.icon && <item.icon className="h-4 w-4 mr-2" />}
                    {item.label}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {hasDesktopActions && (
          <div className="hidden @5xl:flex items-center gap-2 ml-auto">
            {desktopActions.map((action, index) =>
              action.type === "link" && action.href ? (
                <Button key={index} size="sm" asChild>
                  <Link to={action.href}>
                    {action.icon && <action.icon className="h-4 w-4 mr-2" />}
                    {action.label}
                  </Link>
                </Button>
              ) : (
                <Button
                  key={index}
                  variant={action.variant ?? "outline"}
                  size="sm"
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.icon && <action.icon className="h-4 w-4 mr-2" />}
                  {action.label}
                </Button>
              ),
            )}
          </div>
        )}
      </div>
      {/* Mobile stats/badges row */}
      <div className="flex @2xl:hidden items-center gap-3 text-sm text-muted-foreground">
        {stats.slice(0, 2).map((stat, index) => (
          <span key={index} className="flex items-center gap-1">
            <stat.icon className="h-4 w-4" />
            {stat.value} {stat.label}
          </span>
        ))}
        {badges.slice(0, 1).map((badge, index) => (
          <Badge key={index} variant={badge.variant} className="text-xs">
            {badge.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}
