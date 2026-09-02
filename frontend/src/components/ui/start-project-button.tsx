"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface StartProjectButtonProps {
  href?: string;
  label?: string;
  size?: "sm" | "lg";
  className?: string;
}

/**
 * Animated "Start new project" CTA — a burnt-brown adaptation of a 21st.dev
 * pill button. A text pill sits beside a circular icon "coin"; on hover the
 * whole thing deepens to chestnut and the arrow slides out to the right while a
 * second arrow slides in from the left (the classic "arrow travels through"
 * beat).
 *
 * Deliberately rebuilt with plain Tailwind + one lucide icon: it does NOT pull
 * in @base-ui/react, does NOT touch the theme tokens, and does NOT overwrite the
 * app-wide shadcn <Button>. Renders as a Next <Link> because both placements
 * (landing header + closing CTA) navigate to signup.
 */
export default function StartProjectButton({
  href = "/signup",
  label = "Start new project",
  size = "lg",
  className,
}: StartProjectButtonProps) {
  const dims =
    size === "sm"
      ? { pill: "h-10 px-5 text-sm", coin: "h-10 w-10", icon: "h-4 w-4" }
      : { pill: "h-12 px-6 text-base", coin: "h-12 w-12", icon: "h-5 w-5" };

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "group inline-flex w-fit items-center gap-0 rounded-full outline-none",
        "focus-visible:ring-2 focus-visible:ring-[#f5b168] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-[#B45309] font-semibold text-white",
          "transition-colors duration-500 ease-in-out group-hover:bg-[#7C2D12]",
          dims.pill,
        )}
      >
        {label}
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "relative ml-2 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#B45309] text-white",
          "transition-colors duration-500 ease-in-out group-hover:bg-[#7C2D12]",
          dims.coin,
        )}
      >
        {/* Resting arrow — centred, then slides out to the right on hover. */}
        <span className="absolute inset-0 flex items-center justify-center transition-transform duration-500 ease-in-out group-hover:translate-x-[150%] motion-reduce:transition-none">
          <ArrowUpRight className={dims.icon} />
        </span>
        {/* Incoming arrow — waits off to the left, slides to centre on hover. */}
        <span className="absolute inset-0 flex -translate-x-[150%] items-center justify-center transition-transform duration-500 ease-in-out group-hover:translate-x-0 motion-reduce:transition-none">
          <ArrowUpRight className={dims.icon} />
        </span>
      </span>
    </Link>
  );
}
