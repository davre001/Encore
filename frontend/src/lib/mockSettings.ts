export type CheckInterval = "6h" | "24h" | "72h";

export type StyleLock = {
  id: string;
  label: string;
  hint: string;
  locked: boolean;
};

export type SettingsState = {
  tenets: string;
  autoThanks: boolean;
  recutSuggestions: boolean;
  checkInterval: CheckInterval;
  youtubeConnected: boolean;
  youtubeChannel: string;
  locks: StyleLock[];
};

/**
 * A fresh account starts with a blank slate: no voice tenets, no connected
 * channel, no locked styles. Real values arrive from the backend (Minds
 * memories for tenets, health/capabilities for YouTube, the playbook for locks)
 * and from what the creator saves. Nothing here is seeded demo persona.
 */
export const defaultSettings: SettingsState = {
  tenets: "",
  autoThanks: false,
  recutSuggestions: true,
  checkInterval: "24h",
  youtubeConnected: false,
  youtubeChannel: "",
  locks: [],
};

const STORAGE_KEY = "encore.settings";

export function loadSettings(): SettingsState {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) } as SettingsState;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(next: SettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
