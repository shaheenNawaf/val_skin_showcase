import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function mapCategory(c: string): string | null {
  const s = (c || "").toLowerCase();
  if (s.includes("sidearm")) return "Sidearms";
  if (s.includes("smg")) return "SMGs";
  if (s.includes("shotgun")) return "Shotguns";
  if (s.includes("sniper")) return "Sniper Rifles";
  if (s.includes("machine") || s.includes("lmg")) return "Machine Guns";
  if (s.includes("melee")) return "Melees";
  if (s.includes("rifle")) return "Rifles";
  return null;
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
      rows.push({ uuid: s.uuid, weapon: weapon.displayName, category,
                  name: s.displayName, tier: tier.get(s.contentTierUuid) ?? null, icon_url: icon });
    }
  }

  let synced = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("skins")
      .upsert(rows.slice(i, i + 500), { onConflict: "uuid" });
    if (error) return new Response(error.message, { status: 500 });
    synced += Math.min(500, rows.length - i);
  }
  return new Response(JSON.stringify({ ok: true, synced }),
    { headers: { "content-type": "application/json" } });
});