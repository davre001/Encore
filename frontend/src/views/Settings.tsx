"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Reveal from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { DUR, EASE } from "@/lib/motion";
import { useAuth } from "@/context/AuthContext";
import * as api from "@/api/client";
import type { MindTransport, PlaybookRow } from "@/types";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  type CheckInterval,
  type SettingsState,
} from "@/lib/mockSettings";

const intervals: { id: CheckInterval; label: string }[] = [
  { id: "6h", label: "6 hours" },
  { id: "24h", label: "24 hours" },
  { id: "72h", label: "72 hours" },
];

const BADGE_TONES = {
  ok: { background: "rgba(34, 197, 94, 0.15)", color: "var(--success, #22c55e)" },
  warn: { background: "rgba(245, 158, 11, 0.15)", color: "var(--warning, #f59e0b)" },
  idle: { background: "rgba(148, 163, 184, 0.15)", color: "var(--muted, #94a3b8)" },
} as const;

function badgeStyle(tone: keyof typeof BADGE_TONES) {
  return {
    fontSize: "0.8rem",
    padding: "3px 10px",
    borderRadius: "999px",
    fontWeight: 600,
    ...BADGE_TONES[tone],
  };
}

export default function Settings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [playbookRules, setPlaybookRules] = useState<PlaybookRow[]>([]);
  const [mindStatus, setMindStatus] = useState<{
    mindsAvailable: boolean;
    persistentMemoryEnabled: boolean;
    memoriesCount: number;
    transport: MindTransport | null;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const local = loadSettings();
    setSettings(local);

    // 1. Load persistent tenets from Minds DB
    api
      .getMindMemories("tenet")
      .then((mems) => {
        if (mems && mems.length > 0) {
          const latest = mems[mems.length - 1];
          if (latest && latest.content) {
            setSettings((prev) => ({ ...prev, tenets: latest.content }));
          }
        }
      })
      .catch(() => {});

    // 2. Load playbook rules
    api
      .getPlaybook()
      .then((rules) => {
        if (rules && rules.length > 0) {
          setPlaybookRules(rules);
        }
      })
      .catch(() => {});

    // 3. Load Minds status
    api
      .getMindStatus()
      .then((status) => {
        if (status) {
          setMindStatus({
            mindsAvailable: Boolean(status.mindsAvailable),
            persistentMemoryEnabled: Boolean(status.persistentMemoryEnabled),
            memoriesCount: status.memoriesCount || 0,
            transport: status.transport ?? null,
          });
        }
      })
      .catch(() => {});

    // 4. Check YouTube service status
    api
      .getHealth()
      .then((health) => {
        if (health && health.capabilities) {
          const ytOk = Boolean(health.capabilities.youtube);
          setSettings((prev) => ({
            ...prev,
            youtubeConnected: ytOk || prev.youtubeConnected,
            youtubeChannel: user?.handle || (user?.name ? `@${user.name.toLowerCase().replace(/\s+/g, "")}` : prev.youtubeChannel),
          }));
        }
      })
      .catch(() => {});
  }, [user]);

  function update(partial: Partial<SettingsState>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    setSaved(false);
  }

  async function handleToggleRuleLock(rule: PlaybookRow) {
    const updated: PlaybookRow = {
      ...rule,
      locked: !rule.locked,
    };
    setPlaybookRules((prev) =>
      prev.map((r) => (r.style === rule.style ? updated : r))
    );
    try {
      await api.updatePlaybookRule(updated);
    } catch {
      // rollback if needed
    }
  }

  async function handleSave() {
    setSaving(true);
    saveSettings(settings);

    // Persist tenets to Minds memory
    try {
      await api.addMindMemory({
        category: "tenet",
        key: "standing_rules",
        content: settings.tenets,
      });
      // Refresh memory count
      api.getMindStatus().then((s) => {
        if (s) {
          setMindStatus({
            mindsAvailable: Boolean(s.mindsAvailable),
            persistentMemoryEnabled: Boolean(s.persistentMemoryEnabled),
            memoriesCount: s.memoriesCount || 0,
            transport: s.transport ?? null,
          });
        }
      }).catch(() => {});
    } catch (e) {
      console.warn("Failed to persist tenets to Minds memory:", e);
    } finally {
      setSaving(false);
      setSaved(true);
    }
  }

  const channelLabel =
    user?.handle ||
    (user?.name ? `@${user.name.toLowerCase().replace(/\s+/g, "")}` : settings.youtubeChannel || "No channel");

  // Minds wiring, told honestly: a key that is set but rejected must not read
  // as "connected", because the notebook silently answers from the fallback.
  const transport = mindStatus?.transport ?? null;
  const mindLive = Boolean(transport?.reachable);
  const mindKeyed = Boolean(mindStatus?.mindsAvailable);
  const mindTone = mindLive ? "ok" : mindKeyed ? "warn" : "idle";
  const mindHeadline = mindLive
    ? "Minds by Animoca connected"
    : mindKeyed
      ? "Builder API key not accepted"
      : "Deterministic fallback";
  const mindDetail = mindLive
    ? `${transport?.mindsCount === 1 ? "1 Mind" : `${transport?.mindsCount ?? 0} Minds`} on the account; replies come back through conversation “${transport?.alias}”.`
    : mindKeyed
      ? transport?.error || "The key is set but build.hellominds.ai refused it."
      : "Set MINDS_BUILDER_API_KEY from build.hellominds.ai to let a real Mind answer in the notebook.";

  return (
    <main className="settings">
      <Reveal as="header" className="settings__intro">
        <h1>How Encore behaves</h1>
        <p>
          Tenets, what it may do without you, and which styles stay off the
          pack. Profile name and email live on Profile.
        </p>
      </Reveal>

      <Stagger className="settings__panels" stagger={0.08}>
        <StaggerItem as="section" className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Voice</h2>
            <span className="panel__meta">Standing rules, not a prompt</span>
          </div>
          <div className="field">
            <label htmlFor="tenets">Tenets</label>
            <textarea
              id="tenets"
              rows={7}
              value={settings.tenets}
              onChange={(e) => update({ tenets: e.target.value })}
              placeholder="Standing rules for how your cuts should be framed, pacing guidelines, or tone instructions..."
            />
          </div>
        </StaggerItem>

        <StaggerItem as="section" className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Autonomy</h2>
            <span className="panel__meta">What it may do alone</span>
          </div>

          <div className="toggle-row">
            <div>
              <strong>Auto-thanks</strong>
              <p>Send a short thank-you to low-risk comments without asking.</p>
            </div>
            <button
              type="button"
              className={`switch${settings.autoThanks ? " is-on" : ""}`}
              aria-pressed={settings.autoThanks}
              onClick={() => update({ autoThanks: !settings.autoThanks })}
            >
              <span />
            </button>
          </div>

          <div className="toggle-row">
            <div>
              <strong>Recut suggestions</strong>
              <p>When a clip flops, write a new hook from the same moment.</p>
            </div>
            <button
              type="button"
              className={`switch${settings.recutSuggestions ? " is-on" : ""}`}
              aria-pressed={settings.recutSuggestions}
              onClick={() =>
                update({ recutSuggestions: !settings.recutSuggestions })
              }
            >
              <span />
            </button>
          </div>

          <div className="toggle-row">
            <div>
              <strong>Live check</strong>
              <p>How long after a post Encore compares views to your median.</p>
              <div className="interval">
                {intervals.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`btn btn--ghost-solid btn--small${settings.checkInterval === item.id ? " is-on" : ""}`}
                    onClick={() => update({ checkInterval: item.id })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </StaggerItem>

        <StaggerItem as="section" className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Minds by Animoca</h2>
            <span className="panel__meta">{mindHeadline}</span>
          </div>
          <div className="toggle-row">
            <div>
              <strong>Creator Memory</strong>
              <p>
                {mindStatus ? `${mindStatus.memoriesCount} memories stored in database (standing rules, tenets, playbook taste).` : "Loading persistent memory state..."}
              </p>
            </div>
            <span style={badgeStyle("ok")}>Active</span>
          </div>
          <div className="toggle-row">
            <div>
              <strong>Agent transport</strong>
              <p>{mindDetail}</p>
            </div>
            <span style={badgeStyle(mindTone)}>
              {mindLive ? "Live" : mindKeyed ? "Error" : "Fallback"}
            </span>
          </div>
          <div className="toggle-row" style={{ borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.06))", paddingTop: "0.85rem", marginTop: "0.4rem" }}>
            <div>
              <strong>Builder API Key Credential</strong>
              <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--text-muted, #888)", lineHeight: 1.5 }}>
                Get your key from{" "}
                <a
                  href="https://build.hellominds.ai"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent, #6366f1)", textDecoration: "underline" }}
                >
                  build.hellominds.ai
                </a>{" "}
                (issued as a JWT containing your <code>humanId</code>).
                <br />
                Insert into <code>backend/.env</code>:
                <br />
                <code style={{ display: "inline-block", marginTop: "0.35rem", padding: "0.2rem 0.5rem", borderRadius: "4px", background: "rgba(255,255,255,0.08)", fontSize: "0.8rem" }}>
                  MINDS_BUILDER_API_KEY=your_jwt_builder_api_key
                </code>
              </p>
            </div>
          </div>
        </StaggerItem>

        <StaggerItem as="section" className="panel">
          <div className="panel__head">
            <h2 className="panel__title">YouTube</h2>
            <span className="panel__meta">One account for the jam</span>
          </div>
          <div className="youtube-row">
            <div>
              <strong>
                {settings.youtubeConnected
                  ? channelLabel
                  : "No channel connected"}
              </strong>
              <span>
                {settings.youtubeConnected
                  ? "Posts and view checks use this channel"
                  : "Connect to post and watch live numbers"}
              </span>
            </div>
            <button
              type="button"
              className={`btn btn--small ${settings.youtubeConnected ? "btn--danger" : "btn--primary"}`}
              onClick={() =>
                update({ youtubeConnected: !settings.youtubeConnected })
              }
            >
              {settings.youtubeConnected ? "Disconnect" : "Connect"}
            </button>
          </div>
        </StaggerItem>

        <StaggerItem as="section" className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Playbook locks</h2>
            <span className="panel__meta">On = Encore will not suggest it</span>
          </div>
          {playbookRules.length > 0 ? (
            playbookRules.map((rule) => (
              <div key={rule.id || rule.style} className="toggle-row">
                <div>
                  <strong>{rule.style}</strong>
                  <p>{rule.note || `Hit rate ${Math.round(rule.hitRate * 100)}% (${rule.sample} posts)`}</p>
                </div>
                <button
                  type="button"
                  className={`switch${rule.locked ? " is-on" : ""}`}
                  aria-pressed={rule.locked}
                  onClick={() => handleToggleRuleLock(rule)}
                >
                  <span />
                </button>
              </div>
            ))
          ) : (
            settings.locks.map((lock) => (
              <div key={lock.id} className="toggle-row">
                <div>
                  <strong>{lock.label}</strong>
                  <p>{lock.hint}</p>
                </div>
                <button
                  type="button"
                  className={`switch${lock.locked ? " is-on" : ""}`}
                  aria-pressed={lock.locked}
                  onClick={() =>
                    update({
                      locks: settings.locks.map((item) =>
                        item.id === lock.id
                          ? { ...item, locked: !item.locked }
                          : item,
                      ),
                    })
                  }
                >
                  <span />
                </button>
              </div>
            ))
          )}
        </StaggerItem>
      </Stagger>

      <div className="settings__save">
        <button type="button" className="btn btn--primary" disabled={saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save"}
        </button>
        <AnimatePresence>
          {saved ? (
            <motion.span
              className="settings__saved"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: DUR.fast, ease: EASE }}
            >
              Saved to Minds & device
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}
