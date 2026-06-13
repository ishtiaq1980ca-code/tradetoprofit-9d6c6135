// Bearer-token gate for /api/public/bridge/* endpoints. The bridge running
// on the user's Windows machine sends BRIDGE_API_TOKEN as a Bearer header;
// any request missing or mismatching it is rejected before any DB work.
export function checkBridgeAuth(request: Request): Response | null {
  const expected = process.env.BRIDGE_API_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "Bridge auth not configured. Set BRIDGE_API_TOKEN secret." },
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";

  // constant-time compare
  if (got.length !== expected.length) {
    return new Response("Unauthorized", { status: 401 });
  }
  let mismatch = 0;
  for (let i = 0; i < got.length; i++) {
    mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return new Response("Unauthorized", { status: 401 });
  return null;
}
