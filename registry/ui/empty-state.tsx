import { cn } from "@acme/ui/lib/utils";
import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  transitions,
  staggerContainerVariants,
  staggerItemVariants,
} from "@acme/ui/lib/animations";
import { Button } from "./button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  const content = (
    <motion.div
      className="flex flex-col items-center justify-center py-20 text-center"
      variants={staggerContainerVariants}
      initial="hidden"
      animate="visible"
    >
      {Icon && (
        <motion.div
          className="h-20 w-20 rounded-2xl bg-muted flex items-center justify-center mb-6"
          variants={staggerItemVariants}
          whileHover={{ scale: 1.05, rotate: 2 }}
          transition={transitions.springSoft}
        >
          <Icon className="h-10 w-10 text-muted-foreground" />
        </motion.div>
      )}
      <motion.h3 className="text-xl font-heading font-semibold mb-3" variants={staggerItemVariants}>
        {title}
      </motion.h3>
      {description && (
        <motion.p
          className="text-muted-foreground max-w-md mb-8 text-base leading-relaxed"
          variants={staggerItemVariants}
        >
          {description}
        </motion.p>
      )}
      {action && (
        <motion.div variants={staggerItemVariants}>
          <Button onClick={action.onClick}>{action.label}</Button>
        </motion.div>
      )}
    </motion.div>
  );

  if (action?.href) {
    return (
      <a href={action.href} className={cn("block", className)}>
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}
