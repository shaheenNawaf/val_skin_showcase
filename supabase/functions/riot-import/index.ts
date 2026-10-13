// CardForge riot-import — server-side proxy for Riot's private Valorant API.
// Browsers cannot call these endpoints (CORS + credential headers), and seller
// access tokens must never touch storage: the token is used in-memory for this
// one request only and is never logged, cached or persisted.
//
// POST { accessToken, entitlements?, region } -> normalized showcase snapshot.
//
// AUTH — two checks, both fail closed:
//   1. The platform verifies the Supabase JWT. supabase/config.toml pins
//      verify_jwt = true for this function, so a request with no valid session
//      token is rejected before the handler runs.
//   2. The handler forwards the caller's own Authorization header to
//      am_i_seller(), which checks auth.uid() against seller_emails. Only
//      allow-listed sellers reach runImport.
// The caller's Authorization value is never logged, never returned, and never
// interpolated into an error message.
//
// Deploy: supabase functions deploy riot-import --project-ref <ref>
// NEVER add --no-verify-jwt. That flag reopens the endpoint to the public.
//
// The pipeline itself lives in lib.ts (exported `runImport`) so it can be
// unit-tested with a mocked fetch; this file is only the HTTP entrypoint.
import { CORS, json, runImport } from "./lib.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/* True only when the caller's own session belongs to an allow-listed seller.
   The Authorization header is forwarded unchanged so PostgREST resolves
   auth.uid() to that user. Anything that is not an explicit `true` — a network
   failure, a non-200, a null body, a thrown error — reads as "not a seller". */
async function isAllowListedSeller(authHeader: string): Promise<boolean> {
  if (!SB_URL || !SB_ANON_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/am_i_seller`, {
      method: "POST",
      headers: {
        apikey: SB_ANON_KEY,
        authorization: authHeader,
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) {
    return json({ ok: false, error: "sign-in required" }, 401);
  }
  if (!SB_URL || !SB_ANON_KEY) {
    return json({ ok: false, error: "function misconfigured" }, 500);
  }
  if (!(await isAllowListedSeller(authHeader))) {
    return json({ ok: false, error: "not an allow-listed seller" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  const r = await runImport(body);
  return json(r.body, r.status);
});
