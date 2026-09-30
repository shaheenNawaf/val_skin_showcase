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

const REGION_CODE_TO_REGION: Record<string, string> = {
  NA1: "na", NA: "na",
  EUW1: "eu", EUN1: "eu", EUW: "eu", EUN: "eu", EU: "eu",
  KR: "kr",
  BR1: "br", BR: "br",
  LA1: "latam", LA2: "latam", LATAM: "latam",
  AP: "ap", SG1: "ap", SG2: "ap", PH1: "ap", PH2: "ap", TH1: "ap", TH2: "ap",
  VN1: "ap", VN2: "ap", MY1: "ap", MY2: "ap", ID1: "ap", ID2: "ap",
  TW1: "ap", TW2: "ap", HK1: "ap", HK2: "ap",
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
const TYPE_VARIANTS = "3ad1b2b2-acdb-4524-852f-954a76ddae0a";

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

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Read a JWT's `exp` claim (seconds) without verifying the signature.
function jwtExp(jwt: string): number | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(pad));
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

function jwtClaims(jwt: string): any {
  try {
    const part = jwt.split(".")[1];
    if (!part) return {};
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(pad));
  } catch {
    return {};
  }
}

// Current Riot client version, sourced live from valorant-api.com so the pd.*
// calls never go stale across patches. Env override wins; cached 6h; the
// hardcoded value is the offline fallback. The seller token is never sent here.
const VERSION_URL = "https://valorant-api.com/v1/version";
const FALLBACK_CLIENT_VERSION = "release-13.06-shipping-13-5435758";
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;
let versionCache: { value: string; ts: number } | null = null;

async function getClientVersion(): Promise<string> {
  const override = Deno.env.get("RIOT_CLIENT_VERSION");
  if (override) return override;
  const now = Date.now();
  if (versionCache && now - versionCache.ts < VERSION_TTL_MS) return versionCache.value;
  try {
    const r = await fetch(VERSION_URL);
    if (r.ok) {
      const j = await r.json();
      const v = j?.data?.riotClientVersion;
      if (typeof v === "string" && v) {
        versionCache = { value: v, ts: now };
        return v;
      }
    }
  } catch {
    // fall through to cache/default
  }
  return versionCache?.value || FALLBACK_CLIENT_VERSION;
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
  const claims = jwtClaims(token);
  const autoRegion = REGION_CODE_TO_REGION[String(claims?.dat?.r || "").toUpperCase()];
  const region = autoRegion || String(body.region || "na").toLowerCase();
  const shard = SHARDS[region] || "na";
  const regionSource = autoRegion ? "token" : "manual";
  if (!token) return json({ ok: false, error: "accessToken is required" }, 400);

  // Validate shape + expiry before spending a Riot call, so the seller gets an
  // actionable message instead of a generic 401.
  if (!JWT_RE.test(token)) {
    return json({ ok: false, error: "accessToken doesn't look like a Riot JWT (expected a token starting with eyJ…). Paste the token itself, not the surrounding URL or JSON." }, 400);
  }
  const exp = jwtExp(token);
  if (exp !== null) {
    const secsLeft = exp - Math.floor(Date.now() / 1000);
    if (secsLeft <= 0) {
      const mins = Math.max(1, Math.round(-secsLeft / 60));
      return json({ ok: false, error: `Access token expired ~${mins} min ago (Riot tokens last ~1h). Grab a fresh one.` }, 401);
    }
  }

  const clientVersion = await getClientVersion();
  const auth: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Riot-ClientPlatform": CLIENT_PLATFORM,
    "X-Riot-ClientVersion": clientVersion,
  };

  const out: any = { ok: true, region, shard, regionSource, errors: [] as string[] };
  const guard = async (key: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      out.errors.push(`${key} (${(e as Error)?.message || "error"})`);
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
    return json({ ok: false, error: "Riot rejected this access token (invalid, revoked, or wrong region). Re-copy a fresh token and try again." }, 401);
  }

  // Derive the entitlements JWT server-side when the seller didn't paste one, so a
  // single access-token paste is enough for a full import (fire-and-forget).
  let entJwt = ent;
  if (!entJwt) {
    try {
      const er = await fetch("https://entitlements.auth.riotgames.com/api/token/v1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (er.ok) {
        const ej = await er.json();
        entJwt = String(ej.entitlements_token || "").trim();
      }
    } catch {
      // leave entJwt empty; the no-ent path below explains what is missing
    }
  }
  if (entJwt) auth["X-Riot-Entitlements-JWT"] = entJwt;

  const pd = (p: string) => `https://pd.${shard}.a.pvp.net${p}`;

  if (entJwt) {
    await guard("loadout", async () => {
      const paths = [
        `/personalization/v2/players/${out.puuid}/playerloadout`,
        `/personalization/v1/players/${out.puuid}/playerloadout`,
      ];
      let j: any = null;
      const fails: string[] = [];
      const shardList = [shard, ...["na", "eu", "ap", "kr"].filter((s) => s !== shard)];
      let usedShard = "";
      for (const s of shardList) {
        for (const p of paths) {
          try {
            j = await getJSON(`https://pd.${s}.a.pvp.net${p}`, auth);
            usedShard = s;
            break;
          } catch (e) {
            fails.push(`${s}/${p.includes("/v2/") ? "v2" : "v1"}:${(e as Error)?.message || "?"}`);
          }
        }
        if (j) break;
      }
      if (usedShard) out.loadoutShard = usedShard;
      if (!j) {
        try {
          const xp = await getJSON(pd(`/account-xp/v1/players/${out.puuid}`), auth);
          out.level = xp.Progress?.Level ?? null;
          return;
        } catch {
          throw new Error(fails.join(","));
        }
      }
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

    const authNoEnt = { ...auth };
    delete authNoEnt["X-Riot-Entitlements-JWT"];
    const ids = (j: any, type: string) => {
      const all = j?.EntitlementsByTypes || [];
      const bucket = all.find((b: any) => b?.ItemTypeID === type);
      if (bucket) return (bucket.Entitlements || []).map((e: any) => e.ItemID as string);
      // A bulk response may carry several buckets; only accept an untagged single bucket.
      if (all.length === 1) return (all[0]?.Entitlements || []).map((e: any) => e.ItemID as string);
      return [];
    };
    const owned = async (type: string) => {
      const tries: [string, Record<string, string>][] = [
        [`/store/v1/entitlements/${out.puuid}/${type}`, auth],
        [`/store/v1/entitlements/${out.puuid}/${type}`, authNoEnt],
        [`/store/v1/entitlements/${out.puuid}`, auth],
        [`/store/v1/entitlements/${out.puuid}`, authNoEnt],
      ];
      for (const [p, h] of tries) {
        try {
          const got = ids(await getJSON(pd(p), h), type);
          if (got.length) return got;
        } catch {
          // try the next variant
        }
      }
      return [];
    };
    await guard("skins", async () => { out.skins = await owned(TYPE_SKINS); });
    await guard("buddiesOwned", async () => { out.buddiesOwned = await owned(TYPE_BUDDIES); });
    await guard("cardsOwned", async () => { out.cardsOwned = await owned(TYPE_CARDS); });
    await guard("variantsOwned", async () => { out.variantsOwned = await owned(TYPE_VARIANTS); });
  } else {
    out.errors.push("level, rank, wallet and owned items need the entitlements token, and auto-fetching it from your access token failed. Paste one manually in the second field and re-run.");
  }

  const noProfile = out.level == null && !(out.skins || []).length && !out.vp && !out.rp && !out.rankTier;
  if (noProfile) out.errors.push(`no Valorant profile found for this account on shard "${shard}" (no loadout, no inventory). Import with an account that has played Valorant.`);

  return json(out);
});
