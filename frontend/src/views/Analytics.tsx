"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Bars from "@/components/Bars";
import CountUp from "@/components/motion/CountUp";
import Reveal from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { hoverLift } from "@/lib/motion";
import * as api from "@/api/client";
import type { AnalyticsData } from "@/types";
import { formatWhen, loadProjects, type Project } from "@/lib/mockProjects";

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData>({
    posts: [],
    summary: {
      posts: 0,
      totalViews: 0,
      median: 0,
      hitRate: 0,
      hits: 0,
      flops: 0,
      mids: 0,
    },
    playbook: [],
  });
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    setProjects(loadProjects());

    api
      .getAnalytics()
      .then((res) => {
        if (res && res.summary) {
          setData(res);
        }
      })
      .catch(() => {});

    api
      .listProjects()
      .then((backendProjects) => {
        if (!backendProjects || backendProjects.length === 0) return;
        const mapped: Project[] = backendProjects.map((bp) => ({
          id: bp.id,
          name: bp.name,
          updatedAt: bp.updatedAt,
          clips:
            (bp.clips?.length || 0) +
            (bp.takeSegments?.length > 1 ? bp.takeSegments.length : 0),
          status: bp.status,
          verdict: bp.verdict,
          views: bp.views,
          url: bp.postUrl ?? undefined,
        }));
        setProjects((prev) => {
          const ids = new Set(mapped.map((m) => m.id));
          return [...mapped, ...prev.filter((p) => !ids.has(p.id))];
        });
      })
      .catch(() => {});
  }, []);

  const summary = data.summary;
  const posts = data.posts;
  const playbook = data.playbook;

  const leftovers = useMemo(() => {
    return projects
      .filter((p) => p.status === "draft")
      .map((p) => ({
        id: p.id,
        label: p.name,
        from: `${p.clips} clips cut`,
        range: formatWhen(p.updatedAt),
      }));
  }, [projects]);

  return (
    <main className="analytics">
      <Reveal as="header" className="analytics__intro">
        <h1>What actually landed</h1>
        <p>
          Last seven posts versus your median. Hits raise the playbook. Flops
          become recuts. Leftovers wait in the notebook.
        </p>
      </Reveal>

      <Stagger as="section" className="kpi-row" stagger={0.08}>
        <StaggerItem as="article" className="kpi" whileHover={hoverLift}>
          <div className="kpi__label">Posts</div>
          <div className="kpi__value">
            <CountUp value={summary.posts} />
          </div>
          <div className="kpi__hint">This week</div>
        </StaggerItem>
        <StaggerItem as="article" className="kpi" whileHover={hoverLift}>
          <div className="kpi__label">Total views</div>
          <div className="kpi__value">
            <CountUp value={summary.totalViews} />
          </div>
          <div className="kpi__hint">Across all posts</div>
        </StaggerItem>
        <StaggerItem as="article" className="kpi" whileHover={hoverLift}>
          <div className="kpi__label">Your median</div>
          <div className="kpi__value">
            <CountUp value={summary.median} />
          </div>
          <div className="kpi__hint">Flop line is 30% of this</div>
        </StaggerItem>
        <StaggerItem as="article" className="kpi" whileHover={hoverLift}>
          <div className="kpi__label">Hit rate</div>
          <div className="kpi__value">
            <CountUp value={Math.round(summary.hitRate * 100)} suffix="%" />
          </div>
          <div className="kpi__hint">
            {summary.hits} hits · {summary.flops} flops
          </div>
        </StaggerItem>
      </Stagger>

      <div className="analytics__grid">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Views vs your median</h2>
            <span className="panel__meta">Hairline is {summary.median.toLocaleString()}</span>
          </div>
          <Bars posts={posts} median={summary.median} />
          <div className="verdict-row">
            <div className="verdict">
              <span>Hits</span>
              <strong>{summary.hits}</strong>
            </div>
            <div className="verdict">
              <span>Mid</span>
              <strong>{summary.mids}</strong>
            </div>
            <div className="verdict">
              <span>Flops</span>
              <strong>{summary.flops}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Playbook</h2>
            <span className="panel__meta">What Encore will push next</span>
          </div>
          {playbook.length === 0 ? (
            <div style={{ padding: "24px 12px", color: "var(--text-muted, #888)", fontSize: "0.85rem" }}>
              Playbook rules adapt as you publish and check cuts.
            </div>
          ) : (
            <Stagger className="playbook" stagger={0.07}>
              {playbook.map((row) => (
                <StaggerItem as="article" key={row.id || row.style} className="playbook__row">
                  <div className="playbook__top">
                    <strong>{row.style}</strong>
                    <span className="playbook__rate">
                      {percent(row.hitRate)} · {row.sample} posts
                    </span>
                  </div>
                  <p className="playbook__note">{row.note}</p>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </section>
      </div>

      <div className="analytics__grid">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Posted this week</h2>
            <span className="panel__meta">Encore checked these without a prompt</span>
          </div>
          {posts.length === 0 ? (
            <div
              style={{
                padding: "36px 16px",
                textAlign: "center",
                color: "var(--text-muted, #888)",
              }}
            >
              <p style={{ fontWeight: 500 }}>No published posts yet</p>
              <p style={{ fontSize: "0.85rem", marginTop: 4, opacity: 0.75 }}>
                Publish clips from the editor to see automated performance checks here.
              </p>
            </div>
          ) : (
            <table className="post-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Title</th>
                  <th>Hook</th>
                  <th>Views</th>
                  <th>Call</th>
                </tr>
              </thead>
              <Stagger as="tbody" stagger={0.05}>
                {posts.map((post) => (
                  <StaggerItem as="tr" key={post.id}>
                    <td>{post.day}</td>
                    <td>
                      {post.url ? (
                        <a href={post.url} target="_blank" rel="noreferrer">
                          {post.title}
                        </a>
                      ) : (
                        <span>{post.title}</span>
                      )}
                    </td>
                    <td>{post.hook}</td>
                    <td>{post.views.toLocaleString()}</td>
                    <td className={`tag-${post.verdict}`}>{post.verdict}</td>
                  </StaggerItem>
                ))}
              </Stagger>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Leftovers</h2>
            <span className="panel__meta">{leftovers.length} unused beats</span>
          </div>
          {leftovers.length === 0 ? (
            <div
              style={{
                padding: "36px 16px",
                textAlign: "center",
                color: "var(--text-muted, #888)",
              }}
            >
              <p style={{ fontWeight: 500 }}>No unused beats waiting</p>
              <p style={{ fontSize: "0.85rem", marginTop: 4, opacity: 0.75 }}>
                Draft tapes and cut segments from the editor will appear here.
              </p>
            </div>
          ) : (
            <Stagger className="leftover-list" stagger={0.07}>
              {leftovers.map((item) => (
                <StaggerItem as="article" key={item.id} className="leftover">
                  <div className="leftover__top">
                    <strong>{item.label}</strong>
                    <span className="panel__meta">{item.range}</span>
                  </div>
                  <p>{item.from}</p>
                </StaggerItem>
              ))}
            </Stagger>
          )}
          <Link href="/editor" className="btn btn--primary btn--small" style={{ marginTop: "0.85rem" }}>
            Open in editor
          </Link>
        </section>
      </div>
    </main>
  );
}
