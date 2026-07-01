// Bearer-token gate for /api/public/bridge/* endpoints. The bridge running
// on the user's Windows machine can send either the backend bridge token or
// the user's active license token as a Bearer header.
export async function checkBridgeAuth(request: Request): Promise<Response | null> {
  const result = await resolveBridgeAuth(request);
  return "response" in result ? result.response : null;
}

// Same auth check but also returns the user_id of the license token owner
// when a license token was used. Returns userId=null if the shared backend
// bridge token was used (i.e. legacy / admin-level access).
export async function resolveBridgeAuth(
  request: Request,
): Promise<{ response: Response } | { userId: string | null }> {
  const expected = process.env.BRIDGE_API_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!got) return { response: new Response("Unauthorized", { status: 401 }) };

  if (expected && got.length === expected.length) {
    let mismatch = 0;
    for (let i = 0; i < got.length; i++) mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    if (mismatch === 0) return { userId: null };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("license_tokens")
    .select("user_id")
    .eq("token", got.toUpperCase())
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (data) return { userId: data.user_id ?? null };
  return { response: new Response("Unauthorized", { status: 401 }) };
}
