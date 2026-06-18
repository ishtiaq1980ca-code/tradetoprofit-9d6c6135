// Bearer-token gate for /api/public/bridge/* endpoints. The bridge running
// on the user's Windows machine can send either the backend bridge token or
// the user's active license token as a Bearer header.
export async function checkBridgeAuth(request: Request): Promise<Response | null> {
  const expected = process.env.BRIDGE_API_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!got) return new Response("Unauthorized", { status: 401 });

  // First accept the dedicated backend bridge token when configured.
  if (expected && got.length === expected.length) {
    let mismatch = 0;
    for (let i = 0; i < got.length; i++) {
      mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (mismatch === 0) return null;
  }

  // Also accept an active license token so users can configure the downloaded
  // bridge without needing access to server secrets.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("license_tokens")
    .select("id")
    .eq("token", got.toUpperCase())
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (data) {
    return null;
  }

  return new Response("Unauthorized", { status: 401 });
}
