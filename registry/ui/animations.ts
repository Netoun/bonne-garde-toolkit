"use client";

import { useCallback } from "react";
import type { Variants, Transition } from "motion/react";

// === TRANSITIONS ===

export const transitions = {
  fast: {
    duration: 0.15,
    ease: [0.4, 0, 0.2, 1],
  },
  base: {
    duration: 0.2,
    ease: [0.4, 0, 0.2, 1],
  },
  slow: {
    duration: 0.3,
    ease: [0.4, 0, 0.2, 1],
  },
  spring: {
    type: "spring",
    stiffness: 400,
    damping: 25,
  },
  springSoft: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  },
  bounce: {
    type: "spring",
    stiffness: 500,
    damping: 15,
  },
} satisfies Record<string, Transition>;

// === VARIANTS ===

export const scaleVariants: Variants = {
  initial: { scale: 1 },
  hover: { scale: 1.02 },
  tap: { scale: 0.98 },
};

export const scaleUpVariants: Variants = {
  initial: { scale: 1, opacity: 1 },
  hover: { scale: 1.02 },
  tap: { scale: 0.98 },
};

export const liftVariants: Variants = {
  initial: { y: 0 },
  hover: { y: -2 },
  tap: { y: 0 },
};

export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: transitions.base,
  },
};

export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.base,
  },
};

export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.base,
  },
};

export const scaleInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: transitions.springSoft,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: transitions.fast,
  },
};

export const popInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: transitions.spring,
  },
};

export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.base,
  },
};

// === HOOKS ===

interface UseInteractionOptions {
  hoverScale?: number;
  tapScale?: number;
  disabled?: boolean;
}

export function useInteraction(options: UseInteractionOptions = {}) {
  const { hoverScale = 1.02, tapScale = 0.98, disabled = false } = options;

  const getProps = useCallback(
    () => ({
      initial: "initial",
      whileHover: disabled ? undefined : "hover",
      whileTap: disabled ? undefined : "tap",
      variants: {
        initial: { scale: 1 },
        hover: { scale: hoverScale },
        tap: { scale: tapScale },
      },
      transition: transitions.springSoft,
    }),
    [hoverScale, tapScale, disabled],
  );

  return { getProps, transitions };
}

export function useLiftInteraction(options: UseInteractionOptions = {}) {
  const { disabled = false } = options;

  const getProps = useCallback(
    () => ({
      initial: "initial",
      whileHover: disabled ? undefined : "hover",
      whileTap: disabled ? undefined : "tap",
      variants: liftVariants,
      transition: transitions.springSoft,
    }),
    [disabled],
  );

  return { getProps, transitions };
}

export function usePresenceAnimation(variants: Variants = scaleInVariants) {
  return {
    initial: "hidden",
    animate: "visible",
    exit: "exit",
    variants,
    transition: transitions.springSoft,
  };
}

// === CARD INTERACTIONS ===

export const cardHoverProps = {
  initial: { y: 0, boxShadow: "var(--shadow-cozy)" },
  whileHover: {
    y: -2,
    boxShadow: "var(--shadow-lg)",
  },
  whileTap: {
    y: 0,
    boxShadow: "var(--shadow-md)",
  },
  transition: transitions.springSoft,
};

// === BUTTON INTERACTIONS ===

export const buttonTapProps = {
  whileTap: { scale: 0.98 },
  whileHover: { scale: 1.01 },
  transition: transitions.fast,
};

// === STAGGER ANIMATION HELPERS ===

export function createStaggerDelay(index: number, baseDelay = 0.05): number {
  return index * baseDelay;
}

// === FOCUS MANAGEMENT ===

export const focusVisibleProps = {
  whileFocus: {
    boxShadow: "0 0 0 2px var(--ring)",
  },
  transition: transitions.fast,
};
