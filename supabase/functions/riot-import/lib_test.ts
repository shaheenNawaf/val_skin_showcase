// Unit tests for the riot-import pipeline (lib.ts) with a mocked fetch — no
// Riot calls, no network. Run: deno task test  (or: deno test --allow-env)
//
// The mocks mirror the shapes the live API is documented/observed to return:
// account-xp answers only on the account's home shard (404 elsewhere), the
// per-type entitlements endpoint answers with the FLAT shape, and the bulk
// endpoint (when it works at all) answers with the WRAPPED shape.
import {
  CUR_KC,
  CUR_RP,
  CUR_VP,
  runImport,
  TYPE_BUDDIES,
  TYPE_CARDS,
  TYPE_SKINS,
  TYPE_VARIANTS,
  type Fetch,
} from "./lib.ts";

// ── tiny dependency-free asserts ──────────────────────────────────
function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}expected ${b}, got ${a}`);
}
function ok(cond: unknown, msg = "") {
  if (!cond) throw new Error(msg || "expected truthy");
}
function hasErr(out: any, re: RegExp) {
  ok(
    (out.errors || []).some((e: string) => re.test(e)),
    `no error matching ${re} in: ${JSON.stringify(out.errors)}`,
  );
}
function noErr(out: any, re: RegExp) {
  ok(
    !(out.errors || []).some((e: string) => re.test(e)),
    `unexpected error matching ${re} in: ${JSON.stringify(out.errors)}`,
  );
}

// ── fixtures ──────────────────────────────────────────────────────
const PUUID = "puuid-1";

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A token that passes JWT_RE (`eyJ…` on both parts) with a future exp.
const makeToken = (claims: Record<string, unknown> = {}, expSecs = 3600) =>
  `eyJhbGciOiJIUzI1NiJ9.${
    b64url({ exp: Math.floor(Date.now() / 1000) + expSecs, ...claims })
  }.sig`;

const DEFAULT_LOADOUT = {
  Identity: { AccountLevel: 42, PlayerCardID: "card-uuid", PlayerTitleID: "title-uuid" },
  Guns: [{ CharmID: "charm-1" }, { CharmID: "charm-1" }, { CharmID: "charm-2" }],
};

const DEFAULT_MMR = {
  QueueSkills: {
    competitive: {
      SeasonalInfoBySeasonID: {
        "1": { CompetitiveTier: 13, NumberOfWins: 20, WinsByTier: { "13": 10, "14": 2 } },
      },
    },
  },
  LatestCompetitiveUpdate: { TierAfterUpdate: 13, RankedRatingAfterUpdate: 55 },
};

type Reply = { status: number; body?: unknown };

type Opts = {
  home?: string; // shard whose pd.* answers 200; "" = account exists nowhere
  entFail?: boolean; // entitlements derive endpoint fails
  userinfoFail?: boolean;
  perType?: (type: string) => Reply | null; // null → default flat reply
  bulk?: Reply | null; // null → default wrapped-empty reply
  loadout?: Reply | null; // null → default loadout reply
  /** Every pd endpoint answers 200 with empty/default data — Riot's "shadow" profile. */
  shadow?: boolean;
};

const pdShardOf = (url: string) => url.match(/pd\.([a-z]+)\.a\.pvp\.net/)?.[1] || "";

function stdHandler(o: Opts = {}) {
  const home = o.home ?? "na";
  return (url: string): Reply | null => {
    if (url.includes("valorant-api.com/v1/version")) {
      return { status: 200, body: { data: { riotClientVersion: "test-client-version" } } };
    }
    if (url.includes("valorant-api.com/v1/flex")) {
      return { status: 200, body: { data: [{ uuid: "flex-1" }, { uuid: "flex-2" }, { uuid: "not-owned" }] } };
    }
    if (url.includes("auth.riotgames.com/userinfo")) {
      return o.userinfoFail
        ? { status: 401 }
        : { status: 200, body: { sub: PUUID, acct: { game_name: "Test", tag_line: "NA1" } } };
    }
    if (url.includes("entitlements.auth.riotgames.com")) {
      return o.entFail ? { status: 401 } : { status: 200, body: { entitlements_token: makeToken() } };
    }

    const wrongShard = pdShardOf(url) !== home;
    if (url.includes("/account-xp/v1/players/")) {
      if (wrongShard) return { status: 404 };
      return o.shadow
        ? { status: 200, body: { Progress: { Level: 1 } } }
        : { status: 200, body: { Progress: { Level: 42 } } };
    }
    if (url.includes("/personalization/")) {
      if (wrongShard) return { status: 404 };
      if (o.shadow) {
        return {
          status: 200,
          body: {
            Identity: {
              AccountLevel: 1,
              PlayerCardID: "00000000-0000-0000-0000-000000000000",
              PlayerTitleID: "00000000-0000-0000-0000-000000000000",
            },
            Guns: [],
          },
        };
      }
      return o.loadout === undefined ? { status: 200, body: DEFAULT_LOADOUT } : o.loadout;
    }
    if (url.includes("/store/v1/wallet/")) {
      if (wrongShard) return { status: 404 };
      return o.shadow ? { status: 200, body: { Balances: {} } } : { status: 200, body: { Balances: { [CUR_VP]: 1000, [CUR_RP]: 20, [CUR_KC]: 5 } } };
    }
    if (url.includes("/mmr/v1/players/")) {
      if (wrongShard) return { status: 404 };
      return o.shadow ? { status: 200, body: {} } : { status: 200, body: DEFAULT_MMR };
    }
    if (url.includes("/store/v1/entitlements/")) {
      if (wrongShard) return { status: 404 };
      const m = url.match(/\/store\/v1\/entitlements\/[^/]+\/([^/]+)$/);
      if (m) {
        const type = m[1];
        if (o.perType) {
          const r = o.perType(type);
          if (r) return r;
        }
        if (o.shadow) return { status: 200, body: { ItemTypeID: type, Entitlements: [] } };
        // Default: the FLAT per-type shape the live endpoint actually returns.
        return {
          status: 200,
          body: { ItemTypeID: type, Entitlements: [{ ItemID: `item-${type.slice(0, 8)}`, InstanceID: "inst-1" }] },
        };
      }
      // Bulk endpoint.
      if (!(o.bulk === undefined || o.bulk === null)) return o.bulk;
      return o.shadow ? { status: 200, body: { EntitlementsByTypes: [] } } : { status: 200, body: { EntitlementsByTypes: [] } };
    }
    return null;
  };
}

function makeFetch(handler: (url: string, init?: RequestInit) => Reply | null) {
  const calls: string[] = [];
  const f: Fetch = async (url, init) => {
    calls.push(url);
    const r = handler(url, init);
    if (!r) return new Response(`not mocked: ${url}`, { status: 599 });
    return new Response(r.body === undefined ? "{}" : JSON.stringify(r.body), { status: r.status });
  };
  return { f, calls };
}

const importBody = (extra: Record<string, unknown> = {}) =>
  ({ accessToken: makeToken(), region: "na", ...extra });

const bulkCalls = (calls: string[]) =>
  calls.filter((u) => /\/store\/v1\/entitlements\/[^/]+$/.test(u)).length;

// ── response-shape parsing (root cause A) ─────────────────────────

Deno.test("flat per-type entitlements are parsed and deduped", async () => {
  const { f, calls } = makeFetch(stdHandler({
    perType: (type) => type === TYPE_SKINS
      ? {
        status: 200,
        body: {
          ItemTypeID: TYPE_SKINS,
          // Same ItemID repeats once per owned instance (InstanceID differs).
          Entitlements: [
            { ItemID: "skin-1", InstanceID: "i1" },
            { ItemID: "skin-1", InstanceID: "i2" },
            { ItemID: "skin-2", InstanceID: "i3" },
          ],
        },
      }
      : null,
  }));
  const r = await runImport(importBody(), f);
  eq(r.status, 200);
  eq(r.body.skins, ["skin-1", "skin-2"], "skins: ");
  eq(r.body.buddiesOwned, [`item-${TYPE_BUDDIES.slice(0, 8)}`], "buddies: ");
  // Charms dedupe too (same charm on several guns).
  eq(r.body.charms, ["charm-1", "charm-2"], "charms: ");
  noErr(r.body, /skins|buddiesOwned|cardsOwned|variantsOwned/);
  // Per-type succeeded everywhere → bulk is fetched only once, by flex.
  eq(bulkCalls(calls), 1, "bulk fetch count: ");
});

Deno.test("wrapped per-type entitlements are parsed", async () => {
  const { f } = makeFetch(stdHandler({
    perType: (type) => ({
      status: 200,
      body: { EntitlementsByTypes: [{ ItemTypeID: type, Entitlements: [{ ItemID: `w-${type.slice(0, 4)}` }] }] },
    }),
  }));
  const r = await runImport(importBody(), f);
  eq(r.body.skins, [`w-${TYPE_SKINS.slice(0, 4)}`], "skins: ");
  eq(r.body.cardsOwned, [`w-${TYPE_CARDS.slice(0, 4)}`], "cards: ");
  noErr(r.body, /skins|cardsOwned/);
});

Deno.test("flat response tagged with a foreign ItemTypeID is rejected", async () => {
  // A skins call that answers with the BUDDIES type must not leak buddy ids
  // into skins (the old untagged-bucket guess did exactly that).
  const { f } = makeFetch(stdHandler({
    perType: (type) => type === TYPE_SKINS
      ? { status: 200, body: { ItemTypeID: TYPE_BUDDIES, Entitlements: [{ ItemID: "wrong-item" }] } }
      : null,
  }));
  const r = await runImport(importBody(), f);
  eq(r.body.skins, [], "skins must not contain the foreign type's items: ");
  ok(!JSON.stringify(r.body.skins).includes("wrong-item"), "foreign item leaked into skins");
});

// ── authoritative per-type + shared bulk fallback (root causes A/C) ─

Deno.test("empty per-type result falls through to the shared bulk payload", async () => {
  const { f, calls } = makeFetch(stdHandler({
    perType: (type) => type === TYPE_VARIANTS
      ? { status: 200, body: { ItemTypeID: TYPE_VARIANTS, Entitlements: [] } }
      : null,
  }));
  const r = await runImport(importBody(), f);
  eq(r.body.variantsOwned, [], "empty everywhere: ");
  noErr(r.body, /variantsOwned/);
  // owned() fetched the bulk once for the empty type; flex reuses that promise.
  eq(bulkCalls(calls), 1, "bulk fetch count: ");
});

Deno.test("empty per-type falls back to bulk data (Riot serves 200-empty per-type)", async () => {
  const { f } = makeFetch(stdHandler({
    perType: (type) => type === TYPE_SKINS
      ? { status: 200, body: { ItemTypeID: TYPE_SKINS, Entitlements: [] } }
      : null,
    bulk: {
      status: 200,
      body: { EntitlementsByTypes: [{ ItemTypeID: TYPE_SKINS, Entitlements: [{ ItemID: "shadow-skin" }] }] },
    },
  }));
  const r = await runImport(importBody(), f);
  eq(r.body.skins, ["shadow-skin"], "skins recovered from bulk: ");
  noErr(r.body, /skins/);
});

Deno.test("shadow-empty profile (all 200s, no data) produces an actionable note", async () => {
  const { f } = makeFetch(stdHandler({ shadow: true }));
  const r = await runImport(importBody(), f);
  eq(r.body.level, 1, "level: ");
  eq(r.body.skins, [], "skins: ");
  eq(r.body.vp, 0, "vp: ");
  eq(r.body.rankTier, 0, "rankTier: ");
  // No hard errors — every endpoint answered — but the seller gets a hint
  // instead of silent zeros.
  noErr(r.body, /loadout \(|wallet \(|rank \(|skins \(|flexOwned \(/);
  hasErr(r.body, /Riot returned an empty profile/);
  hasErr(r.body, /paste the entitlements token from the local client/);
});

Deno.test("per-type failure falls back to the bulk payload, fetched once", async () => {
  const { f, calls } = makeFetch(stdHandler({
    perType: () => ({ status: 404 }),
    bulk: {
      status: 200,
      body: {
        EntitlementsByTypes: [
          { ItemTypeID: TYPE_SKINS, Entitlements: [{ ItemID: "bulk-skin" }] },
          { ItemTypeID: TYPE_CARDS, Entitlements: [{ ItemID: "bulk-card" }, { ItemID: "bulk-card" }] },
        ],
      },
    },
  }));
  const r = await runImport(importBody(), f);
  eq(r.body.skins, ["bulk-skin"], "skins from bulk: ");
  eq(r.body.cardsOwned, ["bulk-card"], "cards from bulk, deduped: ");
  noErr(r.body, /skins|cardsOwned/);
  // The cached bulk promise is shared by every type AND flex: one fetch total.
  eq(bulkCalls(calls), 1, "bulk fetch count: ");
});

Deno.test("bulk buckets are matched strictly by ItemTypeID", async () => {
  // The account owns cards but no skins: skins must come back empty, never
  // the cards bucket (the old single-untagged-bucket guess corrupted this).
  const { f } = makeFetch(stdHandler({
    perType: () => ({ status: 404 }),
    bulk: {
      status: 200,
      body: { EntitlementsByTypes: [{ ItemTypeID: TYPE_CARDS, Entitlements: [{ ItemID: "card-1" }] }] },
    },
  }));
  const r = await runImport(importBody(), f);
  eq(r.body.skins, [], "skins: ");
  eq(r.body.cardsOwned, ["card-1"], "cards: ");
});

Deno.test("owned-item failures surface explicit errors, fields stay [] (so the editor clears owned state)", async () => {
  const { f } = makeFetch(stdHandler({ perType: () => ({ status: 404 }), bulk: { status: 404 } }));
  const r = await runImport(importBody(), f);
  eq(r.body.skins, [], "skins: ");
  eq(r.body.buddiesOwned, [], "buddies: ");
  eq(r.body.cardsOwned, [], "cards: ");
  eq(r.body.variantsOwned, [], "variants: ");
  eq(r.body.flexOwned, [], "flex: ");
  hasErr(r.body, /^skins \(entitlements failed on na: 404/);
  hasErr(r.body, /^buddiesOwned \(entitlements failed on na/);
  hasErr(r.body, /^cardsOwned \(entitlements failed on na/);
  hasErr(r.body, /^variantsOwned \(entitlements failed on na/);
  hasErr(r.body, /^flexOwned \(bulk entitlements failed on na/);
});

// ── shard resolution (root cause B) ───────────────────────────────

Deno.test("shard probe corrects a wrong region and every later call follows", async () => {
  const { f, calls } = makeFetch(stdHandler({ home: "eu" }));
  const r = await runImport(importBody({ region: "na" }), f);
  eq(r.body.resolvedShard, "eu", "resolvedShard: ");
  eq(r.body.regionCorrected, true, "regionCorrected: ");
  eq(r.body.shard, "eu", "shard: ");
  // Wallet/rank/owned items all answered — they only do so on the home shard.
  eq(r.body.vp, 1000, "vp: ");
  eq(r.body.rankTier, 13, "rankTier: ");
  eq(r.body.peakTier, 14, "peakTier: ");
  eq(r.body.skins, [`item-${TYPE_SKINS.slice(0, 8)}`], "skins: ");
  noErr(r.body, /wallet|rank|skins/);
  // Only the account-xp probe may touch pd.na; everything else runs on pd.eu.
  const naNonProbe = calls.filter((u) => u.includes("pd.na.") && !u.includes("/account-xp/"));
  eq(naNonProbe, [], "non-probe calls on the wrong shard: ");
});

Deno.test("probe level survives a failing loadout", async () => {
  const { f } = makeFetch(stdHandler({ loadout: { status: 404 } }));
  const r = await runImport(importBody(), f);
  eq(r.body.level, 42, "level from probe: ");
  hasErr(r.body, /player card, title and gun buddies unavailable/);
  hasErr(r.body, /level came from the shard probe/);
});

Deno.test("no profile on any shard says so explicitly", async () => {
  const { f } = makeFetch(stdHandler({ home: "" }));
  const r = await runImport(importBody(), f);
  eq(r.body.resolvedShard, null, "resolvedShard: ");
  eq(r.body.level ?? null, null, "level: ");
  hasErr(r.body, /no Valorant profile found for this account \(account-xp answered on none of the shards: na, eu, ap, kr\)/);
});

Deno.test("dat.r claim in the token picks the region", async () => {
  const { f } = makeFetch(stdHandler({ home: "eu" }));
  const r = await runImport({ accessToken: makeToken({ dat: { r: "EUW1" } }) }, f);
  eq(r.body.region, "eu", "region: ");
  eq(r.body.regionSource, "token", "regionSource: ");
  eq(r.body.resolvedShard, "eu", "resolvedShard: ");
  eq(r.body.regionCorrected, false, "no correction needed: ");
});

Deno.test("no entitlements: probe still resolves region and level, error explains the gap", async () => {
  const { f } = makeFetch(stdHandler({ home: "eu", entFail: true }));
  const r = await runImport(importBody({ region: "na" }), f);
  eq(r.body.level, 42, "level from probe without entitlements: ");
  eq(r.body.resolvedShard, "eu", "resolvedShard: ");
  eq(r.body.regionCorrected, true, "regionCorrected: ");
  hasErr(r.body, /^rank, wallet and owned items need the entitlements token/);
});

// ── token validation ──────────────────────────────────────────────

Deno.test("expired token is rejected with 401 before any Riot call", async () => {
  const { f, calls } = makeFetch(stdHandler());
  const r = await runImport({ accessToken: makeToken({}, -600), region: "na" }, f);
  eq(r.status, 401);
  ok(/expired ~10 min ago/.test(r.body.error || ""), `error text: ${r.body.error}`);
  eq(calls, [], "no Riot calls spent: ");
});

Deno.test("malformed token is rejected with 400", async () => {
  const { f } = makeFetch(stdHandler());
  const r = await runImport({ accessToken: "not-a-jwt", region: "na" }, f);
  eq(r.status, 400);
  ok(/doesn't look like a Riot JWT/.test(r.body.error || ""), `error text: ${r.body.error}`);
});

Deno.test("userinfo rejection maps to a re-copy message", async () => {
  const { f } = makeFetch(stdHandler({ userinfoFail: true }));
  const r = await runImport(importBody(), f);
  eq(r.status, 401);
  ok(/Riot rejected this access token/.test(r.body.error || ""), `error text: ${r.body.error}`);
});

// ── flex ──────────────────────────────────────────────────────────

Deno.test("flex items are the intersection of bulk entitlements and the flex catalog", async () => {
  const { f } = makeFetch(stdHandler({
    bulk: {
      status: 200,
      body: {
        EntitlementsByTypes: [
          { ItemTypeID: TYPE_SKINS, Entitlements: [{ ItemID: "some-skin" }] },
          { ItemTypeID: "flex-type", Entitlements: [{ ItemID: "flex-1" }, { ItemID: "not-in-catalog" }] },
        ],
      },
    },
  }));
  const r = await runImport(importBody(), f);
  eq(r.body.flexOwned, ["flex-1"], "flexOwned: ");
  noErr(r.body, /flexOwned/);
});
