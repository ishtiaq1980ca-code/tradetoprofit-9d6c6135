import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveBridgeAuth } from "@/lib/bridge-auth.server";

const Schema = z.object({
  balance: z.number(),
  equity: z.number(),
  margin: z.number().default(0),
  free_margin: z.number().default(0),
  open_positions: z.number().int().default(0),
  daily_pnl: z.number().default(0),
  mode: z.enum(["demo", "real"]).default("demo"),
  login: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? undefined : String(v))),
  name: z.string().optional(),
  server: z.string().optional(),
  company: z.string().optional(),
  currency: z.string().optional(),
  leverage: z.number().int().optional(),
});

export const Route = createFileRoute("/api/public/bridge/account")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await resolveBridgeAuth(request);
        if ("response" in auth) return auth.response;
        const body = await request.json();
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("account_snapshots").insert({ ...parsed.data, user_id: auth.userId });
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
