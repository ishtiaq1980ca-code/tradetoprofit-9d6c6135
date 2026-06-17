import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";

/** Client-side auth gate. Redirects to /auth when no session.
 *  Wrap dashboard children inside AppShell with this. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user && path !== "/auth") navigate({ to: "/auth" });
  }, [loading, user, path, navigate]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
