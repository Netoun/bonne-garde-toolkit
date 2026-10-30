import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "motion/react";

import { cn } from "@acme/ui/lib/utils";
import { transitions } from "@acme/ui/lib/animations";

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-3 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        tertiary: "bg-tertiary text-tertiary-foreground",
        outline: "border-border bg-background text-foreground",
        ghost: "bg-muted text-muted-foreground",
        destructive: "bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string;
  children?: React.ReactNode;
}

function Badge({ className, variant = "default", children }: BadgeProps) {
  return (
    <motion.span
      className={cn(badgeVariants({ variant }), className)}
      initial={{ scale: 1 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={transitions.springSoft}
    >
      {children}
    </motion.span>
  );
}

export type { BadgeProps };
export { Badge, badgeVariants };
