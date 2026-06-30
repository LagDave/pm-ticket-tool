/**
 * SharedTicketView - the public, read-only view of a shared ticket (spec What).
 * Reached via the /?ticket=<token> deep link; fetches the public projection by
 * token through useSharedTicket (§14.3, §15.1) and renders it with the shared
 * TicketReadView. No edit, finalize, comments, or copy actions, and no dashboard
 * navigation - the viewer may be anonymous. No fetch or business logic here
 * (§14.1); the error/empty states render inline (§16.1).
 */
import { useSharedTicket } from "../../hooks/queries/useTicketQueries";
import { TicketReadView } from "./TicketReadView";

interface SharedTicketViewProps {
  token: string;
}

export function SharedTicketView({ token }: SharedTicketViewProps) {
  const { data, isLoading, error } = useSharedTicket(token);

  const isFinal = data?.status === "final";

  return (
    <main className="mx-auto w-[min(720px,calc(100%-32px))] py-10">
      <header className="flex items-center gap-3 mb-7">
        <img
          src="/logo.webp"
          alt=""
          aria-hidden
          width={28}
          height={28}
          className="w-7 h-7 rounded object-contain"
        />
        <span className="eyebrow text-ink">PM Ticket Tool</span>
      </header>

      {isLoading && <p className="text-sm text-muted">Loading ticket…</p>}

      {!isLoading && (error || !data) && (
        <p className="text-sm text-muted">
          This shared ticket link is invalid or no longer available.
        </p>
      )}

      {!isLoading && data && (
        <section className="surface rounded-card p-6">
          <header className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-display text-xl text-ink m-0">Ticket</h2>
            <span className={isFinal ? "pill pill-success" : "pill"}>
              {data.status} · v{data.version}
            </span>
          </header>
          <TicketReadView ticket={data} />
        </section>
      )}
    </main>
  );
}
