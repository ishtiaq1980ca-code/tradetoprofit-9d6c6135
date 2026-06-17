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
      // Server-side validated redemption: SECURITY DEFINER RPC checks the
      // token string, status, expiry, and that it is unclaimed before binding.
      const { error } = await supabase.rpc("redeem_license_token", {
        _token: token,
        _mt5_account: mt5Account || undefined,
      });
      if (error) return { error: error.message };
      await refresh();
      return { ok: true };
    },
    [user, refresh],
  );


  return { license, loading, error, refresh, redeem, valid: isLicenseValid(license) };
}
