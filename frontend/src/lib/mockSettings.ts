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

export const defaultSettings: SettingsState = {
  tenets: [
    "Sound like Mira: short, slightly chaotic, no corporate.",
    "Never pitch merch in a sad or heavy thread.",
    "Mid-tier fans get a real reply, not a heart emoji.",
    "Remember life context and use it next time.",
    "If someone goes quiet for 14 days, check in.",
  ].join("\n"),
  autoThanks: false,
  recutSuggestions: true,
  checkInterval: "24h",
  youtubeConnected: true,
  youtubeChannel: "@mira.studies",
  locks: [
    {
      id: "talking-head",
      label: "Talking-head tips",
      hint: "You skip these. Encore will not suggest them.",
      locked: true,
    },
    {
      id: "tutorial-reels",
      label: "Tutorial hooks on Reels",
      hint: "Last two tutorials died. Prefer story-first.",
      locked: true,
    },
    {
      id: "same-hook",
      label: "Reuse a hook twice in one week",
      hint: "Burned hooks stay off the pack.",
      locked: true,
    },
    {
      id: "confession",
      label: "Confession hooks",
      hint: "These hit. Leave unlocked.",
      locked: false,
    },
  ],
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
