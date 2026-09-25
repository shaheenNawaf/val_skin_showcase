// CardForge riot-import — server-side proxy for Riot's private Valorant API.
// Browsers cannot call these endpoints (CORS + credential headers), and seller
// access tokens must never touch storage: the token is used in-memory for this
// one request only and is never logged, cached or persisted.
//
// POST { accessToken, entitlements?, region } -> normalized showcase snapshot.
// Deploy: supabase functions deploy riot-import --no-verify-jwt

const SHARDS: Record<string, string> = {
  na: "na", br: "na", latam: "na", eu: "eu", ap: "ap", kr: "kr",
};

// Base-64 client-platform blob from the community API docs (value that works).
const CLIENT_PLATFORM =
  "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";

// Wallet currency UUIDs (community-documented constants).
const CUR_VP = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
const CUR_RP = "e59aa87c-4cbf-517a-5983-6e81511be9b7";

// Entitlement ItemTypeIDs (community-documented constants).
const TYPE_SKINS = "e7c63390-eda7-46e0-bb7a-a6abdacd2433";
const TYPE_BUDDIES = "dd3bf334-87f3-40bd-b043-682a57a8dc3a";
const TYPE_CARDS = "3f296c07-64c3-494c-923b-fe692a4fa1bd";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function getJSON(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const token = String(body.accessToken || "").trim();
  const ent = String(body.entitlements || "").trim();
  const region = String(body.region || "na").toLowerCase();
  const shard = SHARDS[region] || "na";
  if (!token) return json({ ok: false, error: "accessToken is required" }, 400);

  const auth: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Riot-ClientPlatform": CLIENT_PLATFORM,
    "X-Riot-ClientVersion": "release-11.08-18-3918089",
  };
  if (ent) auth["X-Riot-Entitlements-JWT"] = ent;

  const out: any = { ok: true, region, shard, errors: [] as string[] };
  const guard = async (key: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      out.errors.push(key);
    }
  };

  // PUUID + Riot ID from the token itself; a failure here means bad/expired token.
  try {
    const info = await getJSON("https://auth.riotgames.com/userinfo", {
      Authorization: `Bearer ${token}`,
    });
    out.puuid = info.sub;
    out.name = info.acct?.game_name || "";
    out.tag = info.acct?.tag_line || "";
  } catch {
    return json({ ok: false, error: "Invalid or expired access token." }, 401);
  }

  const pd = (p: string) => `https://pd.${shard}.a.pvp.net${p}`;

  await guard("loadout", async () => {
    const j = await getJSON(
      pd(`/personalization/v2/players/${out.puuid}/playerloadout`), auth);
    out.level = j.Identity?.AccountLevel ?? null;
    out.playerCard = j.Identity?.PlayerCardID || null;
    out.playerTitle = j.Identity?.PlayerTitleID || null;
    out.charms = (j.Guns || []).map((g: any) => g.CharmID).filter(Boolean);
  });

  await guard("wallet", async () => {
    const j = await getJSON(pd(`/store/v1/wallet/${out.puuid}`), auth);
    const b = j.Balances || {};
    out.vp = b[CUR_VP] ?? 0;
    out.rp = b[CUR_RP] ?? 0;
  });

  await guard("rank", async () => {
    const j = await getJSON(pd(`/mmr/v1/players/${out.puuid}`), auth);
    const qs = j.QueueSkills?.competitive;
    const seasons: any[] = Object.values(qs?.SeasonalInfoBySeasonID || {});
    const cur = j.LatestCompetitiveUpdate?.TierAfterUpdate;
    const seasonTier = seasons.length
      ? Math.max(...seasons.map(s => s.CompetitiveTier || 0))
      : 0;
    out.rankTier = cur ?? seasonTier;
    out.rr = j.LatestCompetitiveUpdate?.RankedRatingAfterUpdate ?? 0;
    out.wins = seasons.length
      ? Math.max(...seasons.map(s => s.NumberOfWins || 0))
      : 0;
    // peak = highest tier number that has recorded wins in any season
    let peak = out.rankTier || 0;
    for (const s of seasons) {
      for (const k of Object.keys(s.WinsByTier || {})) {
        if ((s.WinsByTier[k] || 0) > 0) peak = Math.max(peak, Number(k) || 0);
      }
    }
    out.peakTier = peak;
  });

  if (ent) {
    const owned = async (type: string) => {
      const j = await getJSON(
        pd(`/store/v1/entitlements/${out.puuid}/${type}`), auth);
      return (j.EntitlementsByTypes?.[0]?.Entitlements || [])
        .map((e: any) => e.ItemID as string);
    };
    await guard("skins", async () => { out.skins = await owned(TYPE_SKINS); });
    await guard("buddiesOwned", async () => { out.buddiesOwned = await owned(TYPE_BUDDIES); });
    await guard("cardsOwned", async () => { out.cardsOwned = await owned(TYPE_CARDS); });
  } else {
    out.errors.push("owned-items (no entitlements token)");
  }

  return json(out);
});
