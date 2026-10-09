// CardForge riot-import — server-side proxy for Riot's private Valorant API.
// Browsers cannot call these endpoints (CORS + credential headers), and seller
// access tokens must never touch storage: the token is used in-memory for this
// one request only and is never logged, cached or persisted.
//
// POST { accessToken, entitlements?, region } -> normalized showcase snapshot.
// Deploy: supabase functions deploy riot-import --no-verify-jwt
//
// The pipeline itself lives in lib.ts (exported `runImport`) so it can be
// unit-tested with a mocked fetch; this file is only the HTTP entrypoint.
import { CORS, json, runImport } from "./lib.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  const r = await runImport(body);
  return json(r.body, r.status);
});
