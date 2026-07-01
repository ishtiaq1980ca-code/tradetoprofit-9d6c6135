import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "sonner";
import { ShieldCheck, KeyRound, Users, Trash2, Plus } from "lucide-react";
import { StrategyAdmin } from "@/components/StrategyAdmin";
import { LiveAccountsPerformance } from "@/components/AccountPerformance";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — AurumAI" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { user } = useAuth();
  const { isAdmin, loading } = useIsAdmin();

  if (loading) return <AppShell><div className="p-8 text-sm text-muted-foreground">Loading…</div></AppShell>;
  if (!user) return <AppShell><div className="p-8">Sign in required.</div></AppShell>;
  if (!isAdmin) return <AppShell><ClaimAdmin /></AppShell>;
  return <AppShell><AdminBody /></AppShell>;
}

function ClaimAdmin() {
  const [busy, setBusy] = useState(false);
  const claim = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("claim_admin_if_none");
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) { toast.success("You are now admin. Reloading…"); setTimeout(() => location.reload(), 600); }
    else toast.error("An admin already exists. Ask them to grant you the role.");
  };
  return (
    <div className="p-8 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Admin access</h1>
      <p className="text-sm text-muted-foreground">You don't have admin rights. If no admin has been set up yet, you can claim the role now (one-time only).</p>
      <Button onClick={claim} disabled={busy}>{busy ? "Claiming…" : "Claim admin role"}</Button>
    </div>
  );
}

type Tok = { id: string; token: string; status: string; expires_at: string; user_id: string | null; mt5_account: string | null; notes: string | null; redeemed_at: string | null; created_at: string };
type Usr = { user_id: string; email: string; display_name: string; is_admin: boolean; active_token: string | null; token_expires_at: string | null };

function AdminBody() {
  const [tokens, setTokens] = useState<Tok[]>([]);
  const [users, setUsers] = useState<Usr[]>([]);
  const [newToken, setNewToken] = useState("");
  const [days, setDays] = useState(30);
  const [notes, setNotes] = useState("");

  const refresh = async () => {
    const [t, u] = await Promise.all([
      supabase.from("license_tokens").select("*").order("created_at", { ascending: false }),
      supabase.rpc("list_users_basic"),
    ]);
    if (t.data) setTokens(t.data as any);
    if (u.data) setUsers(u.data as any);
  };
  useEffect(() => { refresh(); }, []);

  const generateRandom = () => {
    const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
    setNewToken(`AURUM-${seg()}-${seg()}`);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newToken.trim()) return toast.error("Enter a token");
    const { error } = await supabase.rpc("admin_generate_token", { _token: newToken.trim(), _days: days, _notes: notes || undefined });
    if (error) return toast.error(error.message);
    toast.success(`Token ${newToken} created (${days}d)`);
    setNewToken(""); setNotes("");
    refresh();
  };

  const expire = async (id: string) => {
    const { error } = await supabase.from("license_tokens").update({ status: "expired" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Token expired");
    refresh();
  };
  const del = async (id: string) => {
    if (!confirm("Delete this token?")) return;
    const { error } = await supabase.from("license_tokens").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Token deleted");
    refresh();
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Generate license tokens, manage users, and monitor access.</p>
        </div>
        <Badge variant="outline" className="border-gold/40 text-gold"><ShieldCheck className="h-3 w-3 mr-1" /> Admin</Badge>
      </header>

      <LiveAccountsPerformance />

      <Card className="border-border/60 bg-card/70">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Generate Token</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 md:grid-cols-[2fr_1fr_2fr_auto_auto] items-end">
            <div>
              <Label className="text-xs">Token code</Label>
              <Input value={newToken} onChange={(e) => setNewToken(e.target.value.toUpperCase())} placeholder="AURUM-XXXX-XXXX" />
            </div>
            <div>
              <Label className="text-xs">Valid (days)</Label>
              <Input type="number" min={1} value={days} onChange={(e) => setDays(+e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
            </div>
            <Button type="button" variant="outline" onClick={generateRandom}>Random</Button>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/70">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> License Tokens ({tokens.length})</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-3 py-2 text-left">Token</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2">Assigned</th><th className="px-3 py-2">MT5</th><th className="px-3 py-2">Notes</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const active = t.status === "active" && new Date(t.expires_at).getTime() > Date.now();
                return (
                  <tr key={t.id} className="border-b border-border/40">
                    <td className="px-3 py-2 font-mono">{t.token}</td>
                    <td className="px-3 py-2 text-center"><Badge variant="outline" className={active ? "border-bull/40 text-bull" : "border-bear/40 text-bear"}>{active ? "active" : t.status}</Badge></td>
                    <td className="px-3 py-2 text-center">{new Date(t.expires_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-center text-muted-foreground">{t.user_id ? t.user_id.slice(0, 8) : "—"}</td>
                    <td className="px-3 py-2 text-center">{t.mt5_account ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.notes ?? ""}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {active && <Button size="sm" variant="ghost" onClick={() => expire(t.id)}>Expire</Button>}
                      <Button size="sm" variant="ghost" onClick={() => del(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                );
              })}
              {tokens.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No tokens yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <StrategyAdmin />

      <Card className="border-border/60 bg-card/70">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Users ({users.length})</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-3 py-2 text-left">Email</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Token</th><th className="px-3 py-2">Token expires</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-b border-border/40">
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.display_name}</td>
                  <td className="px-3 py-2 text-center">{u.is_admin ? <Badge variant="outline" className="border-gold/40 text-gold">admin</Badge> : <span className="text-muted-foreground">user</span>}</td>
                  <td className="px-3 py-2 font-mono text-center">{u.active_token ?? "—"}</td>
                  <td className="px-3 py-2 text-center">{u.token_expires_at ? new Date(u.token_expires_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
