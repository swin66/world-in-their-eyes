# World in Their Eyes

A map-based fan atlas. Explore a band's career — hometowns, studios, legendary gigs, video locations and milestones — on a slick, mobile-first interactive world map. Ships configured for **Depeche Mode**, but everything band-specific lives in two JSON files, so any fanbase can fork it and build their own world.

> *"Let me take you on a trip…"*

## Quick start

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
```

## How it's customised for another band

No code changes needed — edit two files in `public/data/`:

| File | What it holds |
|---|---|
| `band.json` | Band name, tagline, theme colours, map style/centre, categories, badge names |
| `places.json` | GeoJSON of places: title, category, year, summary, full story |

Theme colours in `band.json` are injected as CSS variables at runtime, so the whole UI re-skins itself. Badge names, category labels and the check-in button text are all configurable too (e.g. swap "I made the pilgrimage" / "101" badge for something on-brand for another artist).

| File | What it holds |
|---|---|
| `artists.json` | Offshoots, solo projects and collaborations (Yazoo, Erasure, Recoil, VCMG…) that places can link to via `artistId` |

## Stack (all free-tier friendly)

- **MapLibre GL JS v5** — open-source vector map renderer, no licence cost ever. Globe projection when zoomed out; places render as WebGL circle/symbol layers (no DOM-marker lag) with built-in clustering. Clusters that can't usefully expand (many stories at one spot) open as a full-screen **story wall** ([wall.js](src/wall.js)) — staggered 3D cards, one per event/release/memory, tap-through to the detail sheet. Admins group items onto a shared hotspot via the Places tab ("Group with…" snaps coordinates).
- **Basemap** — currently CARTO Dark Matter (free with attribution). To upgrade visuals, drop a [MapTiler](https://www.maptiler.com/) style URL + free API key (100k tile loads/month free) into `band.json` → `map.styleUrl`.
- **Vite** — fast builds, static output.
- **Supabase (optional)** — accounts + database. Without it the app runs in *local mode*: progress in `localStorage`, no login. With it: magic-link email + Google/Apple sign-in, server-side check-ins that sync across devices, and content served from Postgres.

## Gamification

- **Points** — each check-in earns 10/15/25 pts based on distance from the band's hometown (a pilgrimage to Johannesburg beats a stroll through Basildon).
- **Levels** — DM-flavoured ladder: New Life → Photographic → Everything Counts → Music for the Masses → World in My Eyes → Personal Jesus.
- **Badges** — count-based (Devotee, Pilgrim, 101) plus completion badges per category (Studio Rat, Front Row, Record Collector, Extended Universe…).
- **Fan contributions** — every place has "Add a memory": stories, photos, ticket-stub scans, video and article links. Stored on-device (photos auto-shrunk), pushed to the moderated `memories` table when signed in, with other fans' approved items shown alongside. Contributions earn points and badges (Somebody → See You → Memento Mori).
- **GPS-verified pilgrimages** — checking in physically near a place (within `verified.radiusKm`) triples the points and works toward Walking in My Shoes / Stripped badges.
- **Streaks** — daily activity (check-ins or contributions) builds a streak; best-ever streak earns Get the Balance Right (3) → A Question of Time (7) → Never Let Me Down Again (30).
- **Pilgrimage Passport** — tap the progress ring: level, points bar, streak/shared/verified stats, 20-badge grid, share button. Confetti on badge unlocks and level-ups.

All of it is configured per-band in `band.json` → `gamification`.

## Turning on accounts + database (Supabase, free tier)

1. Create a free project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in the SQL editor (tables + row-level security, including a `memories` table ready for fan-submitted photos/stories).
3. Seed the content: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed`
4. Copy `.env.example` → `.env`, fill in the project URL + anon key, rebuild.
5. For social logins, enable Google/Apple under Authentication → Providers in the Supabase dashboard (magic-link email works out of the box). Providers shown in the UI are listed in `band.json` → `auth.providers`.

The app detects the configuration automatically — no code changes. Signing in merges device progress with the account and syncs both ways.

## Roles & admin tools

Three user levels, stored in the `profiles` table: **admin** (theme/config + content + roles) → **editor** (content only) → **fan**. New signups default to fan; promote your own account once via the SQL snippet at the bottom of `supabase/schema.sql`. Admins and editors get an **Admin tools** button in the account screen:

- **Theme tab** — edit the dark and light palettes (colour pickers per mode), set the default mode, live-preview, then save. With Supabase + admin role it writes to the database; in local mode it downloads an updated `band.json` to commit — the free-tier workflow.
- **Data import tab** — pull an artist's full discography from MusicBrainz (free, no key, runs in the browser) into draft places; editors/admins can push drafts straight to the database.

Users get a dark/light toggle in the top bar; the map basemap switches with it (`themes.dark.mapStyle` / `themes.light.mapStyle` in `band.json`).

## Data importers (run locally)

- `npm run import:setlistfm "Depeche Mode" -- --pages 50` — every concert ever played via the setlist.fm API (free key required), grouped into one place per venue with show counts and year spans. Review the output, then add `--merge` to fold into `places.json`.
- `npm run enrich` — AI-written summaries and stories for imported placeholder places via the Claude API (`ANTHROPIC_API_KEY` required). Prompted to stay factual and general rather than invent specifics — still review before publishing.

## Free hosting / deployment

The build output (`dist/`) is fully static. A GitHub Actions workflow
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) deploys to
**Cloudflare Pages** (free: unlimited bandwidth, custom domains) on every push
to `main`. One-time setup:

1. In your **personal** Cloudflare account: dashboard → My Profile → **API Tokens**
   → Create Token → "Edit Cloudflare Workers" template (or custom with
   *Cloudflare Pages: Edit*). Note your Account ID (dashboard right sidebar).
2. GitHub repo → Settings → Secrets and variables → Actions → add secrets
   **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ACCOUNT_ID`**.
3. Re-run the failed workflow (Actions tab) or push any commit. The site
   appears at `https://world-in-their-eyes.pages.dev`.

When Supabase goes live, add `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
as repository **variables** so production builds include accounts + sync.

## Trips (guided journeys)

The 🧭 button opens **Trips** — curated journeys that fly stop-to-stop with a
route line on the map and prev/next controls, so fans can experience the story
without hunting: *From Basildon, With Synths*, *Every Album, In Order*,
*Conquering America*, *The Berlin Years*, *Through Corbijn's Lens*, member
journeys and more. Defined in [trips.json](public/data/trips.json) as ordered
lists of place ids — fully band-configurable. Completing a trip earns points
and its own badge (each trip's `badge` field).

- **Auto-play** — choose an auto-advance interval (6/8/12/20s) in the trip
  picker and the journey runs hands-free; a ▶/⏸ control sits in the trip bar.
- **Custom trips** — admins/editors build new trips in the admin panel's
  Trips tab (title, emoji, badge, ordered stop picker with reorder). Saved to
  the `trips` table in cloud mode, or downloaded as `trips.json` locally.
- The app opens on a **slowly spinning globe** centred on the median of all
  plotted places; any interaction takes over, and the ⌂ home control returns
  to the spinning globe (and exits any running trip).

Story walls open inside a **three.js planetarium** — a slowly rotating sphere
of glowing particles in the band's colours with pointer parallax
([wallfx.js](src/wallfx.js)). three.js is lazy-loaded only when a wall opens,
so the core map bundle stays lean; it respects `prefers-reduced-motion`.

## Roadmap

**Phase 2 — community backend (still free):** [Supabase](https://supabase.com/) free tier (Postgres + auth + storage). Moves check-ins server-side, adds user accounts, fan-submitted photos/memories per place (moderation queue), and global leaderboards. `src/gamification.js` is already isolated so the localStorage store can be swapped for Supabase calls without touching the UI.

**Phase 3 — gamification deepening:** GPS-verified check-ins (geolocation control is already on the map), rarity scoring for remote places, shareable "pilgrimage passport" cards, seasonal challenges tied to anniversaries (e.g. Violator release date).

**Phase 4 — monetisation (if traction):**
- "Supporter" tier (Stripe/Ko-fi): custom marker styles, offline maps, early access to new eras.
- Self-serve "build your own band atlas" — the multi-tenant version of this codebase; fans pay a small monthly fee for a hosted instance with their own domain.
- Affiliate links for travel/tickets near places (kept tasteful).
- **Important:** stay clearly fan-made and non-commercial regarding band IP — no official logos, artwork or recordings without licence. The attribution line in `band.json` covers this.

## Data accuracy

Some places are flagged `"approx": true` in `places.json` (shown as an "approximate location" tag in the UI) where the exact spot is uncertain or private. Verify and refine coordinates as the community contributes.
