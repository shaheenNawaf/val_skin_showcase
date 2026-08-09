# CardForge MVP

**Build. Verify. Sell.** — inventory showcase cards for any game.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start local server
npm run dev
```

Visit `http://localhost:3000` to use the app.

### Supabase Setup (Phase 1)

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com) and create a new project
   - Copy your project URL and anon key

2. **Run Database Schema**
   ```sql
   -- In Supabase SQL Editor, run:
   -- supabase/schema.sql
   ```

3. **Deploy Edge Function**
   ```bash
   # Install Supabase CLI
   npm install -g supabase
   
   # Login and link
   supabase login
   supabase init
   supabase link --project-ref YOUR_PROJECT_REF
   
   # Deploy function
   supabase functions deploy skin-sync --no-verify-jwt
   
   # Set secret
   supabase secrets set SYNC_SECRET=<random-32-char-string>
   ```

4. **Verify Sync**
   ```bash
   curl -H "x-sync-secret: <YOUR_SECRET>" \
     https://<PROJECT_REF>.supabase.co/functions/v1/skin-sync
   ```

5. **Configure Environment**
   
   Create `.env` file in root:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

6. **Test Locally**
   - Open `index.html` in browser
   - Build your showcase card
   - Click "Publish listing" to create your first listing

## File Structure

```
/workspace
├── index.html              # Main editor application
├── view.html               # Listing viewer page
├── src/
│   └── app.js              # Phase 1 app logic (structured data + Supabase)
├── supabase/
│   ├── schema.sql          # Database schema
│   └── functions/
│       └── skin-sync/
│           ├── index.ts    # Edge function for syncing skin data
│           ├── deno.json   # Deno config
│           └── import_map.json
├── package.json            # Node.js dependencies
├── README.md               # This file
├── ROADMAP.md              # Product roadmap
├── SETUP.md                # Detailed setup instructions
├── POSITIONING.md          # Brand guidelines
└── CONTRACT_CLAUSES.md     # Legal templates
```

## Features

### Current (Prototype)
- ✅ 1920×1080 canvas with PNG export @2×
- ✅ 5 themes: Protocol / Holo / Reaver / Oni / Arctic
- ✅ Live skin picker from valorant-api.com
- ✅ Fast-add UX with keyboard shortcuts
- ✅ Rank picker with official badges
- ✅ Upload avatar, buddies, player card
- ✅ LocalStorage persistence
- ✅ BroadcastChannel presence (same-device only)

### Phase 1 (MVP)
- 🎯 Structured JSON persistence (replaces innerHTML)
- 🎯 Supabase publishing (cross-device links)
- 🎯 Storage bucket for uploads
- 🎯 Realtime Presence (cross-device viewer counter)
- 🎯 Views counter via `bump_views` RPC
- 🎯 Skin catalog caching in database

## Usage

1. **Build Your Card**
   - Select theme from top bar
   - Click "+ Add" on any weapon category
   - Search skins, click to add (Enter adds top result)
   - Upload avatar, buddies, player card
   - Edit text fields (code, prices, rank, notes)

2. **Save/Publish**
   - Save: stores locally in browser
   - Publish: creates shareable link (requires Supabase)

3. **Export**
   - Export PNG: downloads 3840×2160 image

## Tech Stack

- **Frontend**: Vanilla JS + HTML2Canvas
- **Backend**: Supabase (PostgreSQL, Edge Functions, Storage, Realtime)
- **Hosting**: Vercel/Netlify (static site)
- **Data Source**: valorant-api.com (community API)

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for detailed phases:
- Phase 1: Live listings ✅ (in progress)
- Phase 2: Auto-import
- Phase 3: QR + Watermark verification
- Phase 4: Price / Offers / Status
- Phase 5: Harden + first revenue
- Phase 6: Route B (SaaS productization)

## Legal & Positioning

- Product name: **CardForge** (game-agnostic)
- No publisher trademarks in branding
- Disclaimer footer required on all pages
- No on-platform payments or escrow
- See [POSITIONING.md](./POSITIONING.md) and [CONTRACT_CLAUSES.md](./CONTRACT_CLAUSES.md)

## License

MIT
