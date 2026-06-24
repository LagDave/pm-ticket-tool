/**
 * App root. Mounts the React Query provider (§15.1) and the shared toast
 * container (§16.3), then switches between the dashboard (the landing screen),
 * the interview wizard (new session or resume), and a read-only ticket view.
 *
 * View routing is plain UI state (§15.2) - no router library is added (§15.4);
 * this mirrors how the wizard already switches steps with local state. The
 * dashboard hands a session + step to the wizard for resume (spec 4 T5) and a
 * ticket id to the ticket view (spec 4 T6).
 */
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { TicketView } from "./components/ticket/TicketView";
import { queryClient } from "./lib/queryClient";
import { Dashboard } from "./pages/Dashboard";
import { InterviewWizard, type WizardStep } from "./pages/InterviewWizard";

/** Which top-level screen is showing. UI state only (§15.2). */
type View =
  | { name: "dashboard" }
  | { name: "wizard"; sessionId: number | null; step: WizardStep }
  | { name: "ticket"; ticketId: number };

export default function App() {
  const [view, setView] = useState<View>({ name: "dashboard" });

  const goDashboard = (): void => setView({ name: "dashboard" });

  return (
    <QueryClientProvider client={queryClient}>
      {view.name === "dashboard" && (
        <Dashboard
          onOpenSession={(sessionId, step) =>
            setView({ name: "wizard", sessionId, step })
          }
          onViewTicket={(ticketId) => setView({ name: "ticket", ticketId })}
        />
      )}

      {view.name === "wizard" && (
        <InterviewWizard
          initialSessionId={view.sessionId}
          initialStep={view.step}
          onExit={goDashboard}
        />
      )}

      {view.name === "ticket" && (
        <main className="wizard">
          <header className="wizard-header">
            <div className="wizard-topline">
              <div className="wizard-brand">
                <img className="wizard-logo" src="/logo.webp" alt="" aria-hidden width={40} height={40} />
                <h1 className="wizard-title">PM Ticket Tool</h1>
              </div>
              <button type="button" className="link-button" onClick={goDashboard}>
                ← Dashboard
              </button>
            </div>
          </header>
          <TicketView ticketId={view.ticketId} />
        </main>
      )}

      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
