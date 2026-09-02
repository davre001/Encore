"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  Clock,
  Film,
  Lightbulb,
  Minus,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { DUR, EASE } from "@/lib/motion";
import { formatWhen, loadProjects, saveProjects, type Project } from "@/lib/mockProjects";
import {
  CATEGORY_LABEL,
  SORT_LABEL,
  buildHistory,
  diagnoseFlop,
  emptyOverrides,
  loadOverrides,
  saveOverrides,
  sortHistory,
  type HistoryItem,
  type HistoryOverrides,
  type SortKey,
} from "@/lib/mockHistory";

type Filter = "all" | "posted" | "draft" | "leftover" | "flop";

const FILTERS: Filter[] = ["all", "posted", "flop", "draft", "leftover"];
const SORTS: SortKey[] = ["recent", "views", "worst"];

/* Placeholder rows for the pre-load skeleton. Fixed, varied widths (no
   randomness — `Math.random` is unavailable in this render path anyway) so the
   list carries weight from the first paint rather than flashing the sparse
   empty-state panel while `loadProjects()` runs in a post-mount effect. */
const SKELETON_ROWS = [
  { name: "46%", meta: "30%" },
  { name: "38%", meta: "26%" },
  { name: "52%", meta: "34%" },
  { name: "34%", meta: "22%" },
  { name: "44%", meta: "28%" },
];

const VERDICT_ICON = {
  hit: Check,
  mid: Minus,
  flop: TriangleAlert,
} as const;

function matches(item: HistoryItem, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "flop") return item.verdict === "flop";
  return item.category === filter;
}

export default function History() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const [projects, setProjects] = useState<Project[]>([]);
  const [overrides, setOverrides] = useState<HistoryOverrides>(emptyOverrides);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setProjects(loadProjects());
    setOverrides(loadOverrides());
    setLoaded(true);
  }, []);

  useEffect(() => {
    function close(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".history-menu")) setMenuId(null);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const all = useMemo(() => buildHistory(projects, overrides), [projects, overrides]);
  const shown = useMemo(
    () => sortHistory(all.filter((item) => matches(item, filter)), sort),
    [all, filter, sort],
  );

  const counts = useMemo(
    () =>
      FILTERS.reduce<Record<Filter, number>>(
        (acc, key) => {
          acc[key] = all.filter((item) => matches(item, key)).length;
          return acc;
        },
        { all: 0, posted: 0, draft: 0, leftover: 0, flop: 0 },
      ),
    [all],
  );

  function persistProjects(next: Project[]) {
    setProjects(next);
    saveProjects(next);
  }

  function persistOverrides(next: HistoryOverrides) {
    setOverrides(next);
    saveOverrides(next);
  }

  function startRename(item: HistoryItem) {
    setMenuId(null);
    setRenamingId(item.id);
    setDraftName(item.title);
  }

  function commitRename() {
    if (!renamingId) return;
    const name = draftName.trim();
    const item = all.find((entry) => entry.id === renamingId);

    if (name && item) {
      if (item.category === "draft") {
        persistProjects(
          projects.map((project) =>
            project.id === item.id
              ? { ...project, name, updatedAt: Date.now() }
              : project,
          ),
        );
      } else {
        persistOverrides({
          ...overrides,
          renamed: { ...overrides.renamed, [item.id]: name },
        });
      }
    }
    setRenamingId(null);
  }

  function remove(item: HistoryItem) {
    setMenuId(null);
    if (item.category === "draft") {
      persistProjects(projects.filter((project) => project.id !== item.id));
    } else {
      persistOverrides({
        ...overrides,
        hidden: [...overrides.hidden, item.id],
      });
    }
    if (renamingId === item.id) setRenamingId(null);
    if (openId === item.id) setOpenId(null);
  }

  return (
    <main className="dash history">
      <Reveal as="header" className="dash__head">
        <div>
          <h1>Everything you&apos;ve made</h1>
          <p>
            Posted clips, tapes still in draft, and beats you cut but never used.
            Flops carry a reason and a way out.
          </p>
        </div>
        <Link href="/editor" className="btn btn--primary">
          Open editor
        </Link>
      </Reveal>

      <motion.div
        className="hist__bar"
        initial={reduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DUR.base, ease: EASE, delay: 0.1 }}
      >
        <div className="hist__filters" role="tablist" aria-label="Filter history">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? "chip is-on" : "chip"}
              onClick={() => setFilter(key)}
            >
              {CATEGORY_LABEL[key]}
              <em>{counts[key]}</em>
            </button>
          ))}
        </div>

        <label className="hist__sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
      </motion.div>

      {!loaded ? (
        <div className="hist__list" aria-hidden="true">
          {SKELETON_ROWS.map((row, index) => (
            <div key={index} className="hist__item hist__item--skeleton">
              <div className="hist__row">
                <span className="skeleton skeleton--icon" />
                <div className="row__body">
                  <span className="skeleton skeleton--line" style={{ width: row.name }} />
                  <span
                    className="skeleton skeleton--line skeleton--sm"
                    style={{ width: row.meta }}
                  />
                </div>
                <span className="skeleton skeleton--pill" />
              </div>
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <section className="panel">
          <p className="panel__empty">
            Nothing here yet. Drop a long take in the editor and it will show up.
          </p>
        </section>
      ) : (
        <Stagger className="hist__list" stagger={0.04} inView={false}>
          <AnimatePresence initial={false}>
            {shown.map((item) => {
              const diagnosis = diagnoseFlop(item, all);
              const open = openId === item.id;
              const Icon = item.verdict
                ? VERDICT_ICON[item.verdict]
                : item.category === "draft"
                  ? Film
                  : Clock;

              return (
                <StaggerItem
                  as="article"
                  key={item.id}
                  className={`hist__item${open ? " is-open" : ""}`}
                  exit={{ opacity: 0, x: -14, transition: { duration: DUR.fast, ease: EASE } }}
                >
                  <div className="hist__row">
                    <span
                      className={`row__icon is-${item.verdict ?? item.category}`}
                      aria-hidden="true"
                    >
                      <Icon />
                    </span>

                    <div className="row__body">
                      {renamingId === item.id ? (
                        <input
                          value={draftName}
                          autoFocus
                          onChange={(e) => setDraftName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                        />
                      ) : (
                        <p className="row__name">{item.title}</p>
                      )}
                      <p className="row__meta">
                        {item.source}
                        {item.range ? ` · ${item.range}` : ""} · {formatWhen(item.updatedAt)}
                      </p>
                      {diagnosis ? (
                        <button
                          type="button"
                          className={open ? "hist__why-toggle is-on" : "hist__why-toggle"}
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : item.id)}
                        >
                          What went wrong
                          <ChevronDown className={open ? "hist__caret is-up" : "hist__caret"} />
                        </button>
                      ) : null}
                    </div>

                    {item.views !== undefined ? (
                      <div className="hist__views">
                        <strong>{item.views.toLocaleString()}</strong>
                        <span>views</span>
                      </div>
                    ) : (
                      <div className="hist__views" aria-hidden="true" />
                    )}

                    <span className={`pill is-${item.verdict ?? item.category}`}>
                      {item.status}
                    </span>

                    <div className="hist__actions">
                      <div className="history-menu">
                        <button
                          type="button"
                          className="history-menu__dot"
                          aria-haspopup="menu"
                          aria-expanded={menuId === item.id}
                          aria-label={`Actions for ${item.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuId((current) => (current === item.id ? null : item.id));
                          }}
                        >
                          <span />
                          <span />
                          <span />
                        </button>

                        <AnimatePresence>
                          {menuId === item.id ? (
                            <motion.div
                              className="history-menu__list"
                              role="menu"
                              initial={{ opacity: 0, y: -6, scale: 0.96 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.96 }}
                              transition={{ duration: DUR.fast, ease: EASE }}
                            >
                              {item.url ? (
                                <a
                                  role="menuitem"
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => setMenuId(null)}
                                >
                                  Visit YouTube
                                </a>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuId(null);
                                  router.push(`/editor?project=${item.id}`);
                                }}
                              >
                                Re-edit
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => startRename(item)}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="is-danger"
                                onClick={() => remove(item)}
                              >
                                Delete
                              </button>
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {open && diagnosis ? (
                      <motion.div
                        className="hist__why"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: DUR.base, ease: EASE }}
                      >
                        <div className="hist__why-inner">
                          <section>
                            <h3>
                              <TriangleAlert /> What went wrong
                            </h3>
                            <ul>
                              {diagnosis.reasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          </section>

                          <section>
                            <h3>
                              <Lightbulb /> Try instead
                            </h3>
                            <ul>
                              {diagnosis.suggestions.map((suggestion) => (
                                <li key={suggestion}>{suggestion}</li>
                              ))}
                            </ul>
                            <Link href="/editor" className="btn btn--primary btn--small">
                              <RotateCcw /> Queue a recut
                            </Link>
                          </section>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </StaggerItem>
              );
            })}
          </AnimatePresence>
        </Stagger>
      )}
    </main>
  );
}
