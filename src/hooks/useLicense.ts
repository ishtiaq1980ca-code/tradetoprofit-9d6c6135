import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type License = {
  id: string;
  token: string;
  status: string;
  expires_at: string;
  mt5_account: string | null;
  broker: string | null;
  redeemed_at: string | null;
};

export function isLicenseValid(l: License | null | undefined): boolean {
  if (!l) return false;
  if (l.status !== "active") return false;
  return new Date(l.expires_at).getTime() > Date.now();
}

export function useLicense() {
  const { user } = useAuth();
  const [license, setLicense] = useState<License | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setLicense(null);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("license_tokens")
      .select("id, token, status, expires_at, mt5_account, broker, redeemed_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLicense((data as License | null) ?? null);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const redeem = useCallback(
    async (rawToken: string, mt5Account?: string) => {
      if (!user) return { error: "Not signed in" };
      const token = rawToken.trim().toUpperCase();
      if (!token) return { error: "Enter a token" };
      // Look up the token (RLS denies non-admin select unless user_id matches),
      // so we attempt the claim by updating where user_id is null.
      const { data: existing, error: lookupErr } = await supabase
        .from("license_tokens")
        .select("id, user_id, status, expires_at")
        .eq("token", token)
        .maybeSingle();
      if (lookupErr) return { error: lookupErr.message };
      if (!existing) return { error: "Invalid token" };
      if (existing.user_id && existing.user_id !== user.id)
        return { error: "Token already assigned to another account" };
      if (existing.status !== "active") return { error: "Token revoked" };
      if (new Date(existing.expires_at).getTime() <= Date.now())
        return { error: "Token expired" };

      const { error: updErr } = await supabase
        .from("license_tokens")
        .update({
          user_id: user.id,
          mt5_account: mt5Account || null,
          redeemed_at: existing.user_id ? undefined : new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (updErr) return { error: updErr.message };
      await refresh();
      return { ok: true };
    },
    [user, refresh],
  );

  return { license, loading, error, refresh, redeem, valid: isLicenseValid(license) };
}
