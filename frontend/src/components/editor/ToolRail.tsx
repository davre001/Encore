"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  BookmarkCheck,
  Captions,
  CircleUserRound,
  Film,
  Scissors,
  Sparkle,
} from "lucide-react";
import { springSoft } from "@/lib/motion";

/**
 * Encore's real tools: take → moments review → captioned cuts → post →
 * verdict. Standout beats are reviewed here (Keep / Skip) before becoming cuts.
 */
export type ToolId = "take" | "moments" | "cuts" | "caption" | "mind";

const TOOLS: {
  id: ToolId;
  label: string;
  title: string;
  Icon: typeof Film;
}[] = [
  { id: "take", label: "Take", title: "The long take", Icon: Film },
  { id: "moments", label: "Moments", title: "Standout beats (keep or skip)", Icon: BookmarkCheck },
  { id: "cuts", label: "Cuts", title: "Cuts ready to ship", Icon: Scissors },
  { id: "caption", label: "Caption", title: "Title, caption, hashtags", Icon: Captions },
  { id: "mind", label: "Mind", title: "Talk to Encore", Icon: Sparkle },
];

type ToolRailProps = {
  tool: ToolId;
  counts: Partial<Record<ToolId, number>>;
  onTool: (tool: ToolId) => void;
};

export default function ToolRail({ tool, counts, onTool }: ToolRailProps) {
  return (
    <nav className="cut__rail" aria-label="Editor tools">
      {TOOLS.map(({ id, label, title, Icon }) => {
        const active = tool === id;
        const count = counts[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            className={active ? "cut__tool is-active" : "cut__tool"}
            title={title}
            aria-current={active ? "true" : undefined}
            onClick={() => onTool(id)}
          >
            {active ? (
              <motion.span
                layoutId="cut-tool-pill"
                className="cut__tool-pill"
                transition={springSoft}
              />
            ) : null}
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {count > 0 ? (
              <em className="cut__tool-count" aria-hidden="true">
                {count}
              </em>
            ) : null}
          </button>
        );
      })}
      <span className="cut__rail-fill" aria-hidden="true" />
      <span className="cut__rail-div" aria-hidden="true" />
      <Link
        href="/profile"
        className="cut__tool cut__tool--link"
        title="Your profile"
      >
        <CircleUserRound aria-hidden="true" />
        <span>You</span>
      </Link>
    </nav>
  );
}
