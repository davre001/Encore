"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Eye, Film, Minus, Target, TrendingUp } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import ViewsArea from "@/components/charts/ViewsArea";
import VerdictDonut from "@/components/charts/VerdictDonut";
import Reveal from "@/components/motion/Reveal";
import CountUp from "@/components/motion/CountUp";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { DUR, EASE, hoverLift, springSoft } from "@/lib/motion";
import { analyticsPosts, analyticsSummary } from "@/lib/mockAnalytics";
import {
  formatWhen,
  loadProjects,
  saveProjects,
  type Project,
} from "@/lib/mockProjects";

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Early tape";
  if (hour < 17) return "Mid-day cut";
  if (hour < 21) return "Second night";
  return "Up late";
}

function greetingEmoji(hour: number): string {
  if (hour < 5) return "🌙";
  if (hour < 12) return "☀️";
  if (hour < 17) return "🌤️";
  if (hour < 21) return "🌅";
  return "🌙";
}

const PREVIEW = 3;

const VERDICT_ICON = {
  hit: Check,
  mid: Minus,
  flop: CircleAlert,
} as const;

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [projects, setProjects] = useState<Project[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    setProjects(loadProjects());
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    function close(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".history-menu")) setMenuId(null);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  function persist(next: Project[]) {
    setProjects(next);
    saveProjects(next);
  }

  const visible = showAll ? projects : projects.slice(0, PREVIEW);
  const summary = analyticsSummary(analyticsPosts);
  const firstName = (user?.name ?? "there").split(" ")[0];
  const hour = now.getHours();
  const hello = useMemo(() => greeting(hour), [hour]);
  const wave = useMemo(() => greetingEmoji(hour), [hour]);

  const best = analyticsPosts.reduce((top, post) =>
    post.views > top.views ? post : top,
  );

  const cards = [
    {
      label: "Views",
      value: summary.totalViews,
      suffix: "",
      meta: `${summary.posts} posts this week`,
      tone: "",
      Icon: Eye,
      badge: "is-slate",
    },
    {
      label: "Hit rate",
      value: Math.round(summary.hitRate * 100),
      suffix: "%",
      meta: `${summary.hits} hits · ${summary.flops} flops`,
      tone: summary.hitRate >= 0.5 ? "is-up" : "is-down",
      Icon: TrendingUp,
      badge: "is-green",
    },
    {
      label: "Median",
      value: summary.median,
      suffix: "",
      meta: `Best post ran ${(best.views / summary.median).toFixed(1)}× it`,
      tone: "is-up",
      Icon: Target,
      badge: "is-violet",
    },
    {
      label: "Tapes",
      value: projects.length,
      suffix: "",
      meta: "In history",
      tone: "",
      Icon: Film,
      badge: "is-amber",
    },
  ];

  return (
    <main className="dash">
      <Reveal as="header" className="dash__head">
        <div>
          <h1 className="dash__greeting">
            {hello}, {firstName} {wave}
          </h1>
          <p>
            {summary.hits} hits this week · median {summary.median.toLocaleString()}{" "}
            views. Open a tape or pick up a leftover.
          </p>
        </div>
        <Link href="/editor" className="btn btn--primary">
          Open editor
        </Link>
      </Reveal>

      <Stagger className="dash__kpis" stagger={0.07}>
        {cards.map((card) => (
          <StaggerItem
            as="article"
            key={card.label}
            className="metric"
            whileHover={hoverLift}
          >
            <div className="metric__row">
              <span className="metric__label">{card.label}</span>
              <span className={`metric__badge ${card.badge}`} aria-hidden="true">
                <card.Icon />
              </span>
            </div>
            <div className="metric__value">
              <CountUp value={card.value} suffix={card.suffix} />
            </div>
            <div className={`metric__meta ${card.tone}`}>{card.meta}</div>
          </StaggerItem>
        ))}
      </Stagger>

      <div className="dash__row dash__row--wide">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Views this week</h2>
            <Link href="/analytics" className="panel__meta">
              Full analytics
            </Link>
          </div>
          <div className="well">
            <ViewsArea posts={analyticsPosts} median={summary.median} />
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Verdict split</h2>
            <Link href="/analytics" className="panel__meta">
              View all
            </Link>
          </div>
          <div className="well">
            <VerdictDonut
              hits={summary.hits}
              mids={summary.mids}
              flops={summary.flops}
            />
          </div>
        </section>
      </div>

      <div className="dash__row">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Recent tapes</h2>
            {projects.length > PREVIEW ? (
              <button
                type="button"
                className="panel__meta panel__action"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll ? "Show less" : "View all"}
              </button>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <p className="panel__empty">No tapes yet. Open the editor and drop a long take.</p>
          ) : (
            <motion.div className="well well--list" layout>
              <AnimatePresence initial={false}>
                {visible.map((project) => (
                  <motion.article
                    key={project.id}
                    className="row"
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -14, transition: { duration: DUR.fast, ease: EASE } }}
                    transition={springSoft}
                  >
                    <span className="row__thumb" aria-hidden="true">
                      <Film />
                    </span>

                    <div className="row__body">
                      {renamingId === project.id ? (
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
                        <p className="row__name">{project.name}</p>
                      )}
                      <p className="row__meta">
                        {project.clips} clips · {formatWhen(project.updatedAt)}
                      </p>
                    </div>

                    <span className={`pill is-${project.status}`}>{project.status}</span>

                    <div className="history-menu">
                      <button
                        type="button"
                        className="history-menu__dot"
                        aria-haspopup="menu"
                        aria-expanded={menuId === project.id}
                        aria-label={`Actions for ${project.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuId((open) => (open === project.id ? null : project.id));
                        }}
                      >
                        <span />
                        <span />
                        <span />
                      </button>
                      <AnimatePresence>
                        {menuId === project.id ? (
                          <motion.div
                            className="history-menu__list"
                            role="menu"
                            initial={{ opacity: 0, y: -6, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.96 }}
                            transition={{ duration: DUR.fast, ease: EASE }}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuId(null);
                                router.push(`/editor?project=${project.id}`);
                              }}
                            >
                              Re-edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => startRename(project)}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              onClick={() => {
                                setMenuId(null);
                                removeProject(project.id);
                              }}
                            >
                              Delete
                            </button>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Recent activity</h2>
            <Link href="/analytics" className="panel__meta">
              View all
            </Link>
          </div>
          <div className="well well--list">
            {analyticsPosts
              .slice()
              .reverse()
              .slice(0, 4)
              .map((post) => {
                const Icon = VERDICT_ICON[post.verdict];
                return (
                  <article key={post.id} className="row">
                    <span className={`row__icon is-${post.verdict}`} aria-hidden="true">
                      <Icon />
                    </span>
                    <div className="row__body">
                      <p className="row__name">{post.title}</p>
                      <p className="row__meta">
                        {post.views.toLocaleString()} views · {post.day}
                      </p>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      </div>
    </main>
  );

  function startRename(project: Project) {
    setMenuId(null);
    setRenamingId(project.id);
    setDraftName(project.name);
  }

  function commitRename() {
    if (!renamingId) return;
    const name = draftName.trim();
    if (name) {
      persist(
        projects.map((project) =>
          project.id === renamingId ? { ...project, name, updatedAt: Date.now() } : project,
        ),
      );
    }
    setRenamingId(null);
  }

  function removeProject(id: string) {
    persist(projects.filter((project) => project.id !== id));
    if (renamingId === id) setRenamingId(null);
  }
}
