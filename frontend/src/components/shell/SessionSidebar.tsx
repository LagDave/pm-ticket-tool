/**
 * SessionSidebar — the shell's left rail (plan 07012026-deveasy-style-two-pane-shell).
 * Sessions grouped by project, mirroring the DevEasy SessionSidebar: every project
 * is a group with a per-project "new session" action; ungrounded sessions
 * (project_id === null) collect in a "No project" group. A component renders +
 * delegates — it owns only local UI state (status filter, search, delete confirm,
 * §15.2); all server data is React Query (§15.1) read through the hooks (§14.3),
 * and navigation is delegated to the shell via callbacks. Typed, no any (§17.2).
 *
 * Data source: useSessions({ limit: 100 }) — the backend caps a page at 100
 * (MAX_LIMIT), so the rail shows the most recent 100 sessions for the active
 * filter and notes when more exist. There is no per-project session endpoint;
 * grouping is done client-side over the loaded page.
 */
import { Folder, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  useDeleteSession,
  useSessions,
} from "../../hooks/queries/useInterviewSessionQueries";
import { useProjects } from "../../hooks/queries/useProjectQueries";
import type { InterviewSession, SessionStatus } from "../../types/interview";
import type { Project } from "../../types/project";
import { ThemeToggle } from "../ui/ThemeToggle";

interface SessionSidebarProps {
  /** The session currently open in the main pane (highlighted), or null. */
  activeSessionId: number | null;
  /** Open a session in the pane. */
  onSelectSession: (session: InterviewSession) => void;
  /** Start a new session; projectId pre-attaches it (null = ungrounded). */
  onNewSession: (projectId: number | null) => void;
  /** Re-run a session as a fresh clone. */
  onReRun: (session: InterviewSession) => void;
  /** True while a re-run is in flight (disables the buttons). */
  isCloning: boolean;
  /** Open the projects manager in the pane. */
  onOpenProjects: () => void;
}

/** The page size for the rail — the backend's MAX_LIMIT. Named, not magic (§4.2). */
const SIDEBAR_LIMIT = 100;

/** Debounce (ms) before a search keystroke triggers a fetch. Named, not magic. */
const SEARCH_DEBOUNCE_MS = 300;

/** Status filter choices, including "all" (no filter). */
const STATUS_FILTERS: ReadonlyArray<{ value: SessionStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "Active" },
  { value: "awaiting_input", label: "Awaiting" },
  { value: "complete", label: "Done" },
];

/** Per-status dot color + short label for a session row. */
const STATUS_META: Record<SessionStatus, { dot: string; label: string }> = {
  draft: { dot: "bg-faint", label: "Draft" },
  in_progress: { dot: "bg-accent", label: "In progress" },
  awaiting_input: { dot: "bg-accent", label: "Awaiting" },
  complete: { dot: "bg-success", label: "Done" },
  archived: { dot: "bg-faint", label: "Archived" },
};

/** The row's primary label: generated title, else a request snippet. */
function sessionLabel(session: InterviewSession): string {
  const title = session.title?.trim();
  if (title) return title;
  const req = session.original_request.trim();
  return req.length > 80 ? `${req.slice(0, 80)}…` : req;
}

export function SessionSidebar({
  activeSessionId,
  onSelectSession,
  onNewSession,
  onReRun,
  isCloning,
  onOpenProjects,
}: SessionSidebarProps) {
  const [statusFilter, setStatusFilter] = useState<SessionStatus | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce the search box so we fetch once typing pauses, not per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const { data: projects } = useProjects();
  const { data, isLoading } = useSessions({
    page: 1,
    limit: SIDEBAR_LIMIT,
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search === "" ? undefined : search,
  });

  const sessions = data?.items ?? [];
  const total = data?.total ?? 0;
  const sessionsFor = (projectId: number | null): InterviewSession[] =>
    sessions.filter((s) => s.project_id === projectId);
  const ungrouped = sessionsFor(null);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-line bg-surface/40">
      <SidebarHeader
        searchInput={searchInput}
        statusFilter={statusFilter}
        onSearchChange={setSearchInput}
        onStatusChange={setStatusFilter}
        onNewSession={onNewSession}
        onOpenProjects={onOpenProjects}
      />

      {/* Grouped list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading && <p className="px-2 py-3 text-sm text-muted">Loading…</p>}

        {!isLoading &&
          (projects ?? []).map((project) => (
            <ProjectGroup
              key={project.id}
              project={project}
              sessions={sessionsFor(project.id)}
              activeSessionId={activeSessionId}
              isCloning={isCloning}
              onSelectSession={onSelectSession}
              onNewSession={onNewSession}
              onReRun={onReRun}
            />
          ))}

        {!isLoading && ungrouped.length > 0 && (
          <NoProjectGroup
            sessions={ungrouped}
            activeSessionId={activeSessionId}
            isCloning={isCloning}
            onSelectSession={onSelectSession}
            onReRun={onReRun}
          />
        )}

        {!isLoading && sessions.length === 0 && (
          <p className="px-2 py-4 text-sm text-faint">
            {search ? `No sessions match “${search}”.` : "No sessions yet."}
          </p>
        )}

        {total > SIDEBAR_LIMIT && (
          <p className="px-2 pt-2 text-[11px] text-faint">
            Showing the most recent {SIDEBAR_LIMIT} of {total}.
          </p>
        )}
      </div>
    </aside>
  );
}

/** Sidebar top: brand + theme toggle, new-session/projects actions, search + filter. */
function SidebarHeader({
  searchInput,
  statusFilter,
  onSearchChange,
  onStatusChange,
  onNewSession,
  onOpenProjects,
}: {
  searchInput: string;
  statusFilter: SessionStatus | "all";
  onSearchChange: (value: string) => void;
  onStatusChange: (value: SessionStatus | "all") => void;
  onNewSession: (projectId: number | null) => void;
  onOpenProjects: () => void;
}) {
  return (
    <>
      {/* Brand + theme toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <img src="/logo.webp" alt="" aria-hidden width={26} height={26} className="shrink-0" />
          <span className="font-mono text-sm font-bold tracking-tight">PM Ticket Tool</span>
        </div>
        <ThemeToggle />
      </div>

      {/* New session + Projects */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="btn btn-primary flex-1" onClick={() => onNewSession(null)}>
          <Plus size={15} strokeWidth={2.5} aria-hidden />
          New session
        </button>
        <button
          type="button"
          className="btn"
          onClick={onOpenProjects}
          title="Projects"
          aria-label="Projects"
        >
          <Folder size={15} aria-hidden />
        </button>
      </div>

      {/* Search + status filter */}
      <div className="flex flex-col gap-2 px-3 py-3">
        <input
          type="search"
          className="field"
          placeholder="Search sessions…"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search sessions by title"
        />
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onStatusChange(f.value)}
              className={`pill cursor-pointer ${statusFilter === f.value ? "pill-accent" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** A project group: name + per-project new-session, then its session rows. */
function ProjectGroup({
  project,
  sessions,
  activeSessionId,
  isCloning,
  onSelectSession,
  onNewSession,
  onReRun,
}: {
  project: Project;
  sessions: InterviewSession[];
  activeSessionId: number | null;
  isCloning: boolean;
  onSelectSession: (s: InterviewSession) => void;
  onNewSession: (projectId: number | null) => void;
  onReRun: (s: InterviewSession) => void;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate font-mono text-xs font-semibold text-muted">
          {project.name}
        </span>
        <button
          type="button"
          className="btn btn-ghost !px-1.5 !py-1"
          onClick={() => onNewSession(project.id)}
          title={`New session in ${project.name}`}
          aria-label={`New session in ${project.name}`}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-faint">No sessions yet</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              isCloning={isCloning}
              onSelect={onSelectSession}
              onReRun={onReRun}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The "No project" bucket for ungrounded sessions (project_id === null). */
function NoProjectGroup({
  sessions,
  activeSessionId,
  isCloning,
  onSelectSession,
  onReRun,
}: {
  sessions: InterviewSession[];
  activeSessionId: number | null;
  isCloning: boolean;
  onSelectSession: (s: InterviewSession) => void;
  onReRun: (s: InterviewSession) => void;
}) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1.5">
        <span className="truncate font-mono text-xs font-semibold text-faint">No project</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            isCloning={isCloning}
            onSelect={onSelectSession}
            onReRun={onReRun}
          />
        ))}
      </ul>
    </div>
  );
}

/** One session row: status dot + label, with hover-revealed re-run + delete. */
function SessionRow({
  session,
  active,
  isCloning,
  onSelect,
  onReRun,
}: {
  session: InterviewSession;
  active: boolean;
  isCloning: boolean;
  onSelect: (s: InterviewSession) => void;
  onReRun: (s: InterviewSession) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteSession();
  const meta = STATUS_META[session.status];

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onSelect(session)}
        className={`flex w-full items-center gap-2.5 rounded-md py-2 pl-2.5 pr-16 text-left transition-colors ${
          active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
        )}
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} title={meta.label} />
        <span className="min-w-0 flex-1 truncate text-sm">{sessionLabel(session)}</span>
      </button>
      <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          title="Re-run"
          aria-label="Re-run"
          disabled={isCloning}
          onClick={() => onReRun(session)}
        >
          <RotateCcw size={13} aria-hidden />
        </button>
        {confirming ? (
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded text-danger hover:bg-surface-2 disabled:opacity-40"
            title="Confirm delete"
            aria-label={`Confirm delete: ${sessionLabel(session)}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(session.id)}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-surface-2 hover:text-danger"
            title="Delete"
            aria-label={`Delete session: ${sessionLabel(session)}`}
            onClick={() => setConfirming(true)}
            onBlur={() => setConfirming(false)}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}
