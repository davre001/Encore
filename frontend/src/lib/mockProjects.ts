export type ProjectStatus = "draft" | "posted" | "checked";

export type Project = {
  id: string;
  name: string;
  updatedAt: number;
  clips: number;
  status: ProjectStatus;
};

const STORAGE_KEY = "encore.projects";

export const defaultProjects: Project[] = [
  {
    id: "proj_week",
    name: "study-vlog-final",
    updatedAt: Date.now() - 1000 * 60 * 40,
    clips: 3,
    status: "checked",
  },
  {
    id: "proj_recap",
    name: "Kai exam recap",
    updatedAt: Date.now() - 1000 * 60 * 60 * 22,
    clips: 2,
    status: "posted",
  },
  {
    id: "proj_desk",
    name: "desk setup cutdown",
    updatedAt: Date.now() - 1000 * 60 * 60 * 50,
    clips: 1,
    status: "draft",
  },
  {
    id: "proj_night",
    name: "night-shift internship",
    updatedAt: Date.now() - 1000 * 60 * 60 * 80,
    clips: 4,
    status: "checked",
  },
  {
    id: "proj_panic",
    name: "exam-panic leftovers",
    updatedAt: Date.now() - 1000 * 60 * 60 * 140,
    clips: 2,
    status: "draft",
  },
];

export function loadProjects(): Project[] {
  if (typeof window === "undefined") return defaultProjects;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProjects;
    const parsed = JSON.parse(raw) as Project[];
    return parsed.length ? parsed : defaultProjects;
  } catch {
    return defaultProjects;
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
