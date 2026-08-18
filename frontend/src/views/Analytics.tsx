"use client";

import Link from "next/link";
import Bars from "@/components/Bars";
import CountUp from "@/components/motion/CountUp";
import Reveal from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { hoverLift } from "@/lib/motion";
import {
  analyticsPosts,
  analyticsSummary,
  leftovers,
  playbook,
} from "@/lib/mockAnalytics";

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function Analytics() {
  const summary = analyticsSummary(analyticsPosts);

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
          <div className="kpi__hint">Across the seven</div>
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
          <Bars posts={analyticsPosts} median={summary.median} />
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
          <Stagger className="playbook" stagger={0.07}>
            {playbook.map((row) => (
              <StaggerItem as="article" key={row.style} className="playbook__row">
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
        </section>
      </div>

      <div className="analytics__grid">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Posted this week</h2>
            <span className="panel__meta">Encore checked these without a prompt</span>
          </div>
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
              {analyticsPosts.map((post) => (
                <StaggerItem as="tr" key={post.id}>
                  <td>{post.day}</td>
                  <td>
                    <a href={post.url} target="_blank" rel="noreferrer">
                      {post.title}
                    </a>
                  </td>
                  <td>{post.hook}</td>
                  <td>{post.views.toLocaleString()}</td>
                  <td className={`tag-${post.verdict}`}>{post.verdict}</td>
                </StaggerItem>
              ))}
            </Stagger>
          </table>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Leftovers</h2>
            <span className="panel__meta">{leftovers.length} unused beats</span>
          </div>
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
          <Link href="/editor" className="btn btn--primary btn--small" style={{ marginTop: "0.85rem" }}>
            Open in editor
          </Link>
        </section>
      </div>
    </main>
  );
}
