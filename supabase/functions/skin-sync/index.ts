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

  const rows: any[] = [];
  for (const weapon of w.data ?? []) {
    const category = mapCategory(weapon.category);
    if (!category) continue;
    for (const s of weapon.skins ?? []) {
      if (s.displayName === "Standard") continue;
      const icon = s.displayIcon ?? s.chromas?.[0]?.displayIcon;
      if (!icon) continue;
      const chromas = (s.chromas ?? [])
        .map((c: any) => {
          const icon = c.displayIcon ?? c.fullRender ?? c.swatch;
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
      rows.push({ uuid: s.uuid, weapon: weapon.displayName, category,
                  name: s.displayName, tier: tier.get(s.contentTierUuid) ?? null, icon_url: icon,
                  max_level: (s.levels ?? []).length || 1, chromas, levels });
    }
  }

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
