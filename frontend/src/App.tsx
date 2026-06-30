/**
 * App root. Mounts the React Query provider (§15.1), the theme provider, and the
 * shared toast container (§16.3), then chooses between two top-level surfaces:
 *
 *   1. the public read-only shared-ticket view, reached via the /?ticket=<token>
 *      deep link — rendered standalone, OUTSIDE the app shell, so anonymous
 *      viewers get no sidebar or auth chrome (spec What, plan
 *      07012026-deveasy-style-two-pane-shell);
 *   2. the authenticated AppShell — the persistent sidebar + main pane.
 *
 * The only URL the app reads is the `?ticket=` deep link, parsed once on mount.
 * Everything else is in-memory navigation owned by AppShell (§15.2, §15.4 — no
 * router library). Typed, no any (§17.2).
 */
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { AppShell } from "./components/shell/AppShell";
import { SharedTicketView } from "./components/ticket/SharedTicketView";
import { queryClient } from "./lib/queryClient";
import { ThemeProvider } from "./lib/theme";

/** The shared-ticket deep-link token, read once at mount (§15.4 — no router). */
function initialSharedToken(): string | null {
  return new URLSearchParams(window.location.search).get("ticket");
}

export default function App() {
  const [sharedToken] = useState<string | null>(initialSharedToken);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {sharedToken ? <SharedTicketView token={sharedToken} /> : <AppShell />}
        <Toaster position="top-right" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
