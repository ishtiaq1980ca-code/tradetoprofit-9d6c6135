import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkBridgeAuth } from "@/lib/bridge-auth.server";

const Schema = z.object({
  signal_id: z.string().uuid().optional().nullable(),
  symbol: z.string().min(1),
  side: z.string().optional().nullable(),
  action: z.string().min(1),
  retcode: z.number().int().optional().nullable(),
  retry_count: z.number().int().default(0),
  latency_ms: z.number().int().optional().nullable(),
  mt5_ticket: z.number().int().optional().nullable(),
  error: z.string().optional().nullable(),
});

export const Route = createFileRoute("/api/public/bridge/execution_log")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = await checkBridgeAuth(request);
        if (unauth) return unauth;
        const body = await request.json();
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("execution_log").insert(parsed.data);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
