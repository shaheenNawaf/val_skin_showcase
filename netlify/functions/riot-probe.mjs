// TEMPORARY diagnostic — Netlify-side twin of the Supabase riot-probe function.
// Purpose: determine whether Riot serves REAL data to Netlify's function
// egress (AWS Lambda, Node/undici TLS) where Supabase's edge runtime (Deno)
// receives 200-with-empty-data. Fixed endpoint list only; the token is used
// in-memory and never logged. DELETE after diagnosis.
export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const token = String(body.accessToken || "").trim();
  if (!token) return json({ ok: false, error: "accessToken required" }, 400);

  const out = { ok: true, runtime: "netlify-function (node/undici)", probes: [] };
  const add = (name, status, snippet) =>
    out.probes.push({ name, status, snippet: String(snippet).replace(/\s+/g, " ").slice(0, 220) });

  const CLIENT_PLATFORM =
    "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";
  const TYPE_SKINS = "e7c63390-eda7-46e0-bb7a-a6abdacd2433";

  // Egress identity (diagnostic only — no token involved).
  try {
    const r = await fetch("https://api.ipify.org");
    if (r.ok) out.egressIp = (await r.text()).trim();
  } catch { /* ignore */ }

  // Client version, live.
  let version = "release-13.06-shipping-18-5590001";
  try {
    const r = await fetch("https://valorant-api.com/v1/version");
    if (r.ok) {
      const j = await r.json();
      if (typeof j?.data?.riotClientVersion === "string") version = j.data.riotClientVersion;
    }
  } catch { /* keep fallback */ }
  out.version = version;

  // userinfo → puuid.
  let puuid = "";
  try {
    const r = await fetch("https://auth.riotgames.com/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const t = await r.text();
    add("userinfo", r.status, t);
    if (r.ok) puuid = JSON.parse(t).sub;
  } catch (e) {
    add("userinfo", 0, String(e));
  }
  if (!puuid) return json(out);

  // Derive the entitlement (no body — matrix-proven equivalent on Supabase).
  let ent = "";
  try {
    const r = await fetch("https://entitlements.auth.riotgames.com/api/token/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const t = await r.text();
    add("derive", r.status, t);
    if (r.ok) ent = String(JSON.parse(t).entitlements_token || "");
  } catch (e) {
    add("derive", 0, String(e));
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Riot-ClientPlatform": CLIENT_PLATFORM,
    "X-Riot-ClientVersion": version,
  };
  if (ent) headers["X-Riot-Entitlements-JWT"] = ent;

  const endpoints = [
    ["account-xp", `/account-xp/v1/players/${puuid}`],
    ["loadout-v2", `/personalization/v2/players/${puuid}/playerloadout`],
    ["wallet", `/store/v1/wallet/${puuid}`],
    ["skins", `/store/v1/entitlements/${puuid}/${TYPE_SKINS}`],
  ];
  for (const [name, path] of endpoints) {
    try {
      const r = await fetch(`https://pd.na.a.pvp.net${path}`, { headers });
      const t = await r.text();
      add(name, r.status, t);
    } catch (e) {
      add(name, 0, String(e));
    }
  }

  return json(out);
};
