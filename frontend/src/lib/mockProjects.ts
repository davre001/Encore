export type ProjectStatus = "draft" | "posted" | "checked";

export type Project = {
  id: string;
  name: string;
  updatedAt: number;
  clips: number;
  status: ProjectStatus;
  /** Set once the project's cut has been posted & checked. */
  verdict?: "hit" | "mid" | "flop";
  views?: number;
  url?: string;
};

const STORAGE_KEY = "encore.projects";

/**
 * Projects are real, per-account records loaded from the backend (and cached in
 * localStorage for offline resume). There are no seeded demo tapes — a fresh
 * account starts empty and fills up as the creator uploads and cuts.
 */
export function loadProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function formatWhen(ts: number): string {
  const delta = Date.now() - ts;
  const mins = Math.floor(delta / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
