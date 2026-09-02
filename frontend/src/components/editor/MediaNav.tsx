"use client";

import { motion } from "motion/react";
import {
  Clapperboard,
  Heart,
  Image,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  User,
  Video,
  Wrench,
} from "lucide-react";
import type { MediaFilter } from "@/lib/studioAssets";
import { springSoft } from "@/lib/motion";

const primary: { id: MediaFilter; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "all", label: "All Media", Icon: LayoutGrid },
  { id: "images", label: "Images", Icon: Image },
  { id: "videos", label: "Videos", Icon: Video },
  { id: "characters", label: "Characters", Icon: User },
  { id: "scenes", label: "Scenes", Icon: Clapperboard },
  { id: "favorites", label: "Favorites", Icon: Heart },
];

type MediaNavProps = {
  filter: MediaFilter;
  collapsed: boolean;
  onFilter: (id: MediaFilter) => void;
  onToggle: () => void;
};

export default function MediaNav({
  filter,
  collapsed,
  onFilter,
  onToggle,
}: MediaNavProps) {
  function item(id: MediaFilter, label: string, Icon: typeof LayoutGrid) {
    const active = filter === id;
    return (
      <button
        key={id}
        type="button"
        className={active ? "media-nav__item is-active" : "media-nav__item"}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        onClick={() => onFilter(id)}
      >
        {active ? (
          <motion.span
            layoutId="media-nav-pill"
            className="media-nav__pill"
            transition={springSoft}
          />
        ) : null}
        <Icon className="media-nav__icon" aria-hidden="true" />
        <span className="media-nav__label">{label}</span>
      </button>
    );
  }

  return (
    <aside className="media-nav" aria-label="Media library">
      {primary.map(({ id, label, Icon }) => item(id, label, Icon))}
      <span className="media-nav__rule" aria-hidden="true" />
      {item("tools", "Tools", Wrench)}
      <span className="media-nav__fill" aria-hidden="true" />
      {item("trash", "Trash", Trash2)}
      <button
        type="button"
        className="media-nav__item"
        onClick={onToggle}
        aria-pressed={collapsed}
        aria-label={collapsed ? "Expand media nav" : "Collapse media nav"}
      >
        {collapsed ? (
          <PanelRightOpen className="media-nav__icon" aria-hidden="true" />
        ) : (
          <PanelRightClose className="media-nav__icon" aria-hidden="true" />
        )}
        <span className="media-nav__label">Collapse</span>
      </button>
    </aside>
  );
}
