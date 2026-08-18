"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Reveal from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { DUR, EASE } from "@/lib/motion";
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

export default function Settings() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function update(partial: Partial<SettingsState>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    setSaved(false);
  }

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
  }

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
            <h2 className="panel__title">YouTube</h2>
            <span className="panel__meta">One account for the jam</span>
          </div>
          <div className="youtube-row">
            <div>
              <strong>
                {settings.youtubeConnected
                  ? settings.youtubeChannel
                  : "No channel"}
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
          {settings.locks.map((lock) => (
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
          ))}
        </StaggerItem>
      </Stagger>

      <div className="settings__save">
        <button type="button" className="btn btn--primary" onClick={handleSave}>
          Save
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
              Saved on this device
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}
