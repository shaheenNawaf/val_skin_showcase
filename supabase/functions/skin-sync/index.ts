import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function mapCategory(c: string): string | null {
  const s = (c || "").toLowerCase();
  if (s.includes("sidearm")) return "Sidearms";
  if (s.includes("smg")) return "SMGs";
  if (s.includes("shotgun")) return "Shotguns";
  if (s.includes("sniper")) return "Sniper Rifles";
  if (s.includes("machine") || s.includes("lmg") || s.includes("heavy")) return "Machine Guns";
  if (s.includes("melee")) return "Melees";
  if (s.includes("rifle")) return "Rifles";
  return null;
}

function chromaLabel(skinName: string, dn: string): string {
  const raw = String(dn || "").replace(/\r?\n/g, " ").trim();
  const m = raw.match(/\(([^)]+)\)\s*$/);
  if (m) return m[1];
  return raw === skinName ? "Standard" : raw || "Standard";
}

// media.valorant-api.com serves this placeholder (HTTP 200, 14,515 bytes)
// at URLs the API still populates whenever Riot never published the asset —
// it renders as a big X. Verified by exact SHA-256; re-derive with:
//   curl -s https://media.valorant-api.com/weaponskins/27f21d97-4c4b-bd1c-1f08-31830ab0be84/displayicon.png | sha256sum
const PLACEHOLDER_SHA256 = "6e236924d463ed12aba89c6b5c3dec87f35aeb57aac8b9068fe96377d113de8f";

// First candidate that downloads and is NOT the placeholder wins. A network
// hiccup keeps the URL (optimistic — the same trust the old sync had); a
// definitive non-2xx or a placeholder hash moves to the next candidate.
async function realIconUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    let hex = "";
    for (const b of digest) hex += b.toString(16).padStart(2, "0");
    return hex === PLACEHOLDER_SHA256 ? null : url;
  } catch {
    return url;
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-sync-secret") !== Deno.env.get("SYNC_SECRET"))
    return new Response("unauthorized", { status: 401 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const [w, t] = await Promise.all([
    fetch("https://valorant-api.com/v1/weapons?language=en-US").then(r => r.json()),
    fetch("https://valorant-api.com/v1/contenttiers?language=en-US").then(r => r.json()),
  ]);
  const tier = new Map((t.data ?? []).map((x: any) => [x.uuid, x.displayName]));

  type Task = { weapon: any; category: string; skin: any; standard: boolean };
  const tasks: Task[] = [];
  for (const weapon of w.data ?? []) {
    const category = mapCategory(weapon.category);
    if (!category) continue;
    for (const s of weapon.skins ?? []) {
      if (s.displayName === "Standard") continue; // melee default: no art by design
      tasks.push({ weapon, category, skin: s, standard: String(s.displayName || "").startsWith("Standard") });
    }
  }

  // Resolve every skin's icon with bounded concurrency. Standard/default
  // skins start from the weapon's own render (that is where their real art
  // lives — every skin-level URL serves the placeholder). Skinned weapons
  // try the skin-level displayIcon first, then the chroma and level-1 icons:
  // Prime Guardian and the Sovereign line ship real art only on the
  // chroma/level while the skin-level URL serves the placeholder.
  const icons = new Array<string | null>(tasks.length).fill(null);
  let next = 0;
  const POOL = 20;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const { weapon, skin, standard } = tasks[i];
      const c0 = skin.chromas?.[0];
      const candidates: (string | null | undefined)[] = standard
        ? [weapon.displayIcon, skin.displayIcon, c0?.fullRender]
        : [skin.displayIcon, c0?.displayIcon, c0?.fullRender, skin.levels?.[0]?.displayIcon];
      for (const c of candidates) {
        const u = await realIconUrl(c);
        if (u) { icons[i] = u; break; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, tasks.length) }, worker));

  const rows: any[] = [];
  tasks.forEach((task, i) => {
    const icon = icons[i];
    if (!icon) return; // no usable art anywhere — keep whatever the DB already has
    const s = task.skin;
    // Standard skins' chroma displayIcons are placeholders too — prefer the
    // fullRender (the actual weapon render) for them.
    const chromas = (s.chromas ?? [])
      .map((c: any) => {
        const icon = task.standard
          ? (c.fullRender ?? c.displayIcon ?? c.swatch)
          : (c.displayIcon ?? c.fullRender ?? c.swatch);
        if (!icon) return null;
        const raw = String(c.displayName ?? "").replace(/\r?\n/g, " ").trim();
        const unlock = (raw.match(/Level (\d+)/) ?? [])[1];
        return {
          uuid: c.uuid,
          label: chromaLabel(s.displayName, c.displayName),
          icon,
          swatch: c.swatch ?? null,
          unlock: unlock ? Number(unlock) : null,
        };
      })
      .filter(Boolean);
    const levels = (s.levels ?? [])
      .map((l: any, i: number) => ({ uuid: l.uuid, level: i + 1 }))
      .filter((l: any) => l.uuid);
    rows.push({ uuid: s.uuid, weapon: task.weapon.displayName, category: task.category,
                name: s.displayName, tier: tier.get(s.contentTierUuid) ?? null, icon_url: icon,
                max_level: (s.levels ?? []).length || 1, chromas, levels });
  });

  let synced = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("skins")
      .upsert(rows.slice(i, i + 500), { onConflict: "uuid" });
    if (error) return new Response(error.message, { status: 500 });
    synced += Math.min(500, rows.length - i);
  }

  const cacheSources: [string, string][] = [
    ["competitivetiers", "https://valorant-api.com/v1/competitivetiers?language=en-US"],
    ["buddies", "https://valorant-api.com/v1/buddies?language=en-US"],
    ["playercards", "https://valorant-api.com/v1/playercards?language=en-US"],
  ];
  const cacheRows: any[] = [];
  for (const [key, url] of cacheSources) {
    try {
      const j = await fetch(url).then((r) => r.json());
      if (Array.isArray(j.data)) cacheRows.push({ key, data: j.data });
    } catch { /* skip this key; the skins sync already succeeded */ }
  }
  let cached = 0;
  if (cacheRows.length) {
    const { error } = await supabase.from("catalog_cache")
      .upsert(cacheRows, { onConflict: "key" });
    if (error) return new Response(error.message, { status: 500 });
    cached = cacheRows.length;
  }
  return new Response(JSON.stringify({ ok: true, synced, cached }),
    { headers: { "content-type": "application/json" } });
});
