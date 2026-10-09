// CardForge riot-import core — the import pipeline, extracted from the edge
// function entrypoint (index.ts) so it can be unit-tested with an injected
// fetch. Seller access tokens must never touch storage: the token is used
// in-memory for this one request only and is never logged, cached or persisted.
//
// Request flow (kept deliberately small — Riot rate-limits, and seller tokens
// expire in ~1h): userinfo → entitlements derive → shard probe (account-xp
// across all four shards, which also yields the level) → loadout → wallet →
// rank → per-type entitlements (authoritative; the undocumented bulk endpoint
// is only a failure fallback, fetched once and shared) → flex catalog.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

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
export const CUR_VP = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
export const CUR_RP = "e59aa87c-4cbf-517a-5983-6e81511be9b7";
export const CUR_KC = "85ca954a-41f2-ce94-9b45-8ca3dd39a00d"; // Kingdom Credits (valorant-api.com/v1/currencies)

// Entitlement ItemTypeIDs (community-documented constants).
export const TYPE_SKINS = "e7c63390-eda7-46e0-bb7a-a6abdacd2433";
export const TYPE_BUDDIES = "dd3bf334-87f3-40bd-b043-682a57a8dc3a";
export const TYPE_CARDS = "3f296c07-64c3-494c-923b-fe692a4fa1bd";
export const TYPE_VARIANTS = "3ad1b2b2-acdb-4524-852f-954a76ddae0a";

// Injectable fetch so the pipeline is testable without hitting Riot.
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function getJSON(url: string, headers: Record<string, string>, f: Fetch) {
  const r = await f(url, { headers });
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

async function getClientVersion(f: Fetch): Promise<string> {
  const override = Deno.env.get("RIOT_CLIENT_VERSION");
  if (override) return override;
  const now = Date.now();
  if (versionCache && now - versionCache.ts < VERSION_TTL_MS) return versionCache.value;
  try {
    const r = await f(VERSION_URL);
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

function posNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function runImport(
  body: any,
  f: Fetch = fetch,
): Promise<{ status: number; body: any }> {
  const token = String(body.accessToken || "").trim();
  const ent = String(body.entitlements || "").trim();
  const claims = jwtClaims(token);
  const autoRegion = REGION_CODE_TO_REGION[String(claims?.dat?.r || "").toUpperCase()];
  const region = autoRegion || String(body.region || "na").toLowerCase();
  const requestedShard = SHARDS[region] || "na";
  // Mutable: the shard probe below may discover the account lives elsewhere,
  // and every later pd.* call must follow (wallet/rank/entitlements all 404
  // on the wrong shard — that was the "partially retrieved" bug).
  let shard = requestedShard;
  const regionSource = autoRegion ? "token" : "manual";
  if (!token) return { status: 400, body: { ok: false, error: "accessToken is required" } };

  // Validate shape + expiry before spending a Riot call, so the seller gets an
  // actionable message instead of a generic 401.
  if (!JWT_RE.test(token)) {
    return { status: 400, body: { ok: false, error: "accessToken doesn't look like a Riot JWT (expected a token starting with eyJ…). Paste the token itself, not the surrounding URL or JSON." } };
  }
  const exp = jwtExp(token);
  if (exp !== null) {
    const secsLeft = exp - Math.floor(Date.now() / 1000);
    if (secsLeft <= 0) {
      const mins = Math.max(1, Math.round(-secsLeft / 60));
      return { status: 401, body: { ok: false, error: `Access token expired ~${mins} min ago (Riot tokens last ~1h). Grab a fresh one.` } };
    }
  }

  const clientVersion = await getClientVersion(f);
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
    }, f);
    out.puuid = info.sub;
    out.name = info.acct?.game_name || "";
    out.tag = info.acct?.tag_line || "";
  } catch {
    return { status: 401, body: { ok: false, error: "Riot rejected this access token (invalid, revoked, or wrong region). Re-copy a fresh token and try again." } };
  }

  // Derive the entitlements JWT server-side when the seller didn't paste one, so a
  // single access-token paste is enough for a full import (fire-and-forget).
  let entJwt = ent;
  if (!entJwt) {
    try {
      const er = await f("https://entitlements.auth.riotgames.com/api/token/v1", {
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

  // ── Shard probe ───────────────────────────────────────────────────
  // The requested region is only a guess: `dat.r` is absent from many Riot
  // tokens and the editor's region select defaults to NA. account-xp is the
  // cheapest profile check, so probe it across all four shards; the first 2xx
  // pins the real shard for every later call and yields the level as a bonus.
  // ≤4 requests. (account-xp needs no entitlements header, so this also works
  // — and still corrects the region — when entitlements derivation failed.)
  out.resolvedShard = null;
  const probeShards = [shard, ...["na", "eu", "ap", "kr"].filter((s) => s !== shard)];
  for (const s of probeShards) {
    try {
      const xp = await getJSON(`https://pd.${s}.a.pvp.net/account-xp/v1/players/${out.puuid}`, auth, f);
      shard = s;
      out.shard = s;
      out.resolvedShard = s;
      const lvl = posNum(xp.Progress?.Level ?? xp.Progression?.Level ?? xp.level);
      if (lvl != null) out.level = lvl;
      break;
    } catch {
      // no profile on this shard (404) or transient failure — try the next
    }
  }
  out.regionCorrected = !!out.resolvedShard && out.resolvedShard !== requestedShard;

  if (entJwt) {
    // ── Loadout: v2 → v1 on the resolved shard, entitlements header first.
    // (Was a 4-shard × 3-path × 2-header matrix — up to 24 requests — because
    // the shard was unknown; the probe now pins it up front.)
    await guard("loadout", async () => {
      const noEnt = { ...auth };
      delete noEnt["X-Riot-Entitlements-JWT"];
      const paths = [
        `/personalization/v2/players/${out.puuid}/playerloadout`,
        `/personalization/v1/players/${out.puuid}/playerloadout`,
      ];
      let j: any = null;
      let lastErr = "";
      for (const p of paths) {
        for (const [hName, h] of [["ent", auth], ["noent", noEnt]] as [string, Record<string, string>][]) {
          try {
            j = await getJSON(pd(p), h, f);
            break;
          } catch (e) {
            lastErr = `${p.split("/")[2]}/${hName}:${(e as Error)?.message || "?"}`;
          }
        }
        if (j) break;
      }
      if (!j) {
        if (out.level != null) {
          out.errors.push(`player card, title and gun buddies unavailable (playerloadout ${lastErr} on ${shard}); level came from the shard probe`);
          return;
        }
        throw new Error(lastErr || `failed on ${shard}`);
      }
      out.level = posNum(j.Identity?.AccountLevel) ?? out.level ?? null;
      out.playerCard = j.Identity?.PlayerCardID || null;
      out.playerTitle = j.Identity?.PlayerTitleID || null;
      // The same charm can sit on several guns — dedupe.
      out.charms = [...new Set((j.Guns || []).map((g: any) => g.CharmID).filter(Boolean))];
    });

    await guard("wallet", async () => {
      const j = await getJSON(pd(`/store/v1/wallet/${out.puuid}`), auth, f);
      const b = j.Balances || {};
      out.vp = b[CUR_VP] ?? 0;
      out.rp = b[CUR_RP] ?? 0;
      out.kc = b[CUR_KC] ?? 0;
    });

    await guard("rank", async () => {
      const j = await getJSON(pd(`/mmr/v1/players/${out.puuid}`), auth, f);
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

    // ── Owned items ─────────────────────────────────────────────────
    const authNoEnt = { ...auth };
    delete authNoEnt["X-Riot-Entitlements-JWT"];

    // Riot serves two shapes from the store entitlements endpoints and the
    // community docs disagree on which is canonical, so accept both:
    //   flat    { ItemTypeID, Entitlements: [{ ItemID, InstanceID }, …] }
    //           — what the live per-type endpoint returns; the same ItemID
    //             repeats once per owned instance, so dedupe.
    //   wrapped { EntitlementsByTypes: [{ ItemTypeID, Entitlements: […] }] }
    // Matching is strict on ItemTypeID: an untagged or foreign bucket is never
    // assumed to be the requested type (that silently returned another type's
    // items whenever the requested type was legitimately empty). Returns null
    // for an unrecognized shape so callers can tell "empty" from "unparseable".
    const idsFrom = (j: any, type: string): string[] | null => {
      const dedupe = (arr: any[]): string[] => {
        const seen = new Set<string>();
        const ids: string[] = [];
        for (const e of arr || []) {
          const id = e?.ItemID;
          if (typeof id === "string" && id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
        return ids;
      };
      if (Array.isArray(j?.Entitlements)) {
        if (typeof j.ItemTypeID === "string" && j.ItemTypeID && j.ItemTypeID !== type) return null;
        return dedupe(j.Entitlements);
      }
      if (Array.isArray(j?.EntitlementsByTypes)) {
        const bucket = j.EntitlementsByTypes.find((b: any) => b?.ItemTypeID === type);
        return bucket ? dedupe(bucket.Entitlements) : [];
      }
      return null;
    };

    // The bulk endpoint (/store/v1/entitlements/{puuid}, no type) is not in the
    // community endpoint lists; it is only a fallback for when the per-type
    // call fails, fetched once and shared by every type and by flex.
    let bulkPromise: Promise<any> | null = null;
    const getBulk = (): Promise<any> => {
      if (!bulkPromise) {
        bulkPromise = (async () => {
          let lastErr = "";
          for (const h of [auth, authNoEnt]) {
            try {
              return await getJSON(pd(`/store/v1/entitlements/${out.puuid}`), h, f);
            } catch (e) {
              lastErr = (e as Error)?.message || "error";
            }
          }
          throw new Error(`bulk entitlements failed on ${shard} (${lastErr})`);
        })();
      }
      return bulkPromise;
    };

    // The per-type call is authoritative: any 2xx — even an empty list — is the
    // real answer. Only a request failure or an unrecognized shape falls
    // through to the bulk payload; if that fails too, the caller gets an
    // explicit error instead of a silently empty import.
    const owned = async (type: string): Promise<string[]> => {
      const path = `/store/v1/entitlements/${out.puuid}/${type}`;
      let lastErr = "";
      for (const h of [auth, authNoEnt]) {
        try {
          const got = idsFrom(await getJSON(pd(path), h, f), type);
          if (got) return got;
          lastErr = "unrecognized response shape";
        } catch (e) {
          lastErr = (e as Error)?.message || "error";
        }
      }
      try {
        const got = idsFrom(await getBulk(), type);
        if (got) return got;
        lastErr = `${lastErr}; bulk: unrecognized response shape`;
      } catch (e) {
        lastErr = `${lastErr}; ${(e as Error)?.message || "error"}`;
      }
      throw new Error(`entitlements failed on ${shard}: ${lastErr}`);
    };

    // Owned-item defaults: a fetch failure must read as "empty + explicit
    // error", never as "field absent" — the editor only resets its owned state
    // when a field is present, so an absent array would leave the PREVIOUS
    // import's inventory on the card. Legit-empty (2xx) lands here as [] too;
    // the errors array is what distinguishes the two.
    out.skins = [];
    out.buddiesOwned = [];
    out.cardsOwned = [];
    out.variantsOwned = [];
    out.flexOwned = [];
    await guard("skins", async () => { out.skins = await owned(TYPE_SKINS); });
    await guard("buddiesOwned", async () => { out.buddiesOwned = await owned(TYPE_BUDDIES); });
    await guard("cardsOwned", async () => { out.cardsOwned = await owned(TYPE_CARDS); });
    await guard("variantsOwned", async () => { out.variantsOwned = await owned(TYPE_VARIANTS); });
    await guard("flexOwned", async () => {
      // Flex = agent-worn accessories (Expressions Wheel). No public ItemTypeID
      // constant exists, so intersect the bulk entitlements payload with the
      // public flex catalog (23 items) instead of a per-type call.
      const flex = await getJSON("https://valorant-api.com/v1/flex", {}, f).catch(() => null);
      const flexIds = new Set(((flex as any)?.data || []).map((x: any) => x.uuid as string));
      if (!flexIds.size) { out.flexOwned = []; return; }
      const bulk = await getBulk(); // the same single shared fetch
      const ids = new Set<string>();
      const buckets: any[] = Array.isArray(bulk?.EntitlementsByTypes) ? bulk.EntitlementsByTypes : [];
      if (buckets.length) {
        for (const b of buckets) {
          for (const e of b?.Entitlements || []) if (e?.ItemID) ids.add(e.ItemID);
        }
      } else if (Array.isArray(bulk?.Entitlements)) {
        for (const e of bulk.Entitlements) if (e?.ItemID) ids.add(e.ItemID);
      }
      out.flexOwned = [...ids].filter((id) => flexIds.has(id));
    });
  } else {
    const missing = out.level == null
      ? "level, rank, wallet and owned items"
      : "rank, wallet and owned items";
    out.errors.push(`${missing} need the entitlements token, and auto-fetching it from your access token failed. Paste one manually in the second field and re-run.`);
  }

  // The shard probe already fetched account-xp on every shard, so if the
  // loadout carried no level and the probe found none, there is nothing left
  // to try — say so explicitly instead of failing silently.
  if (entJwt && out.level == null) {
    out.errors.push("account level unavailable: playerloadout returned no level and account-xp found no level on any shard (the account may hide its level, or has never played Valorant)");
  }

  const noProfile = out.level == null && !(out.skins || []).length && !out.vp && !out.rp && !out.rankTier;
  if (noProfile) out.errors.push(`no Valorant profile found for this account (account-xp answered on none of the shards: ${probeShards.join(", ")}). Import with an account that has played Valorant.`);

  return { status: 200, body: out };
}
