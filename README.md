# Global Hotspot Atlas

Turn scattered international news into a single, rotatable, clickable map of relationships.

The output is **one self-contained HTML file** (~130KB) with zero external dependencies: no CDN, no API key, and it opens by double-click even offline — so you can hand it straight to someone else.

It combines a 3D globe (events plotted as glowing dots) with a force-directed entity graph (people / organizations / countries / places / topics and how they connect), plus optional narrative tours, source-dispute comparisons, and "what-if" simulations.

## When to use

Trigger this skill when any of these fit:

- You want to see recent global or regional hotspots on a map, not just read a paragraph.
- You need to visualize how key figures, organizations, countries, and issues relate to each other.
- You're building a situation dashboard, a news-aggregation page, or a geopolitics debrief.
- The user mentions "3D globe", "relationship graph", "event timeline", "hotspot map", or "global situation".

**Not suitable for:** a plain news summary (answer directly), a static world map (use a normal map tool), or real-time streaming updates (this skill produces a snapshot).

## Requirements

- **Node.js** (for the fetch / scaffold / build scripts).
- Network access for news fetching (falls back to WebSearch / hand-written data if unavailable).

## Workflow

Run the steps strictly in order. Only **Step 3** requires real judgment; the rest are deterministic.

> **Path convention:** all scripts are called with the skill's **absolute path** (the Base directory reported when the skill loads). Your working directory stays in the user's project, so intermediate artifacts land there instead of polluting the skill. Below, `$SKILL` stands for that absolute path — set it first:
>
> ```bash
> SKILL="/absolute/path/global-hotspot-atlas"
> ```

### Step 0 · Set parameters (don't ask — use defaults)

| Parameter        | Default                  | Notes                                  |
| ---------------- | ------------------------ | -------------------------------------- |
| Time window      | 48 hours                 | Use 168 if the user says "this week".  |
| Event count      | 12–16 events             | < 8 looks empty; > 20 fights for space |
| Scope            | Global                   | Restrict to one region if named        |
| Output directory | `hotspot/` in cwd        | Keep intermediate files there          |

If the user says nothing, use the defaults. Only ask when the scope genuinely can't be inferred.

### Step 1 · Collect

Prefer the script (one call, multi-source structured data):

```bash
mkdir -p hotspot
node "$SKILL/scripts/fetch.mjs" --hours 48 --limit 40 --out hotspot/raw.json
```

The script prints per-source success/failure. Rule of thumb: **≥ 10 candidates with coordinates → proceed**.

If the script fails or returns too little, fall back to **WebSearch**: search 1–2 times across six facets (conflict / politics / economy / tech / climate / society) and compile your own candidate list. See `references/sources.md`.

### Step 2 · Generate skeleton

```bash
node "$SKILL/scripts/scaffold.mjs" --raw hotspot/raw.json --out hotspot/atlas.json --pick 14
```

This produces a **valid but thin** `atlas.json`: all events present, but `entities` and `relations` are empty. You then edit incrementally.

If Step 1 used WebSearch, skip this step and hand-write `atlas.json` per `references/schema.md`.

### Step 3 · Edit atlas.json (the core step)

Do only these things, then stop:

1. **Rewrite `summary`** for each event: 60–120 chars, answering "who / did what / why it matters". Don't echo the headline; don't pile on adjectives.
2. **Add `entities`**: 15–30. Types are limited to `person` / `org` / `country` / `place` / `topic`. Fewer, but real — only keep roles that appear across multiple events.
3. **Add `relations`**: 30–60, wiring entities to events and entities to each other.
4. **(Optional) higher-tier fields:**
   - `heatReasons`: 3–4 phrases explaining *why* an event is hot.
   - `disputes`: conflicting accounts of the same event, side-by-side.
   - `simulation`: hypothetical what-ifs, e.g. "if a ceasefire holds, which events ease / worsen".
   - `meta.story`: narrative tour steps that auto-fly the globe and highlight events on play.
   - `blindspots`: under-reported regions flagged as "this is burning but nobody's covering it".

`relations[].type` accepts only these seven values (anything else falls back to `related`):

| type          | meaning                       | typical use                  |
| ------------- | ----------------------------- | ---------------------------- |
| `participate` | participate / lead / launch   | a country in talks, org leading |
| `stance`      | voice / pressure / condemn / support | official statement        |
| `sanction`    | sanction / block / confront   | export controls, economic sanctions |
| `cooperate`   | cooperate / talk / sign / aid | bilateral deal, military aid |
| `cause`       | cause / trigger               | event A sparks market swing  |
| `located`     | happened at / located in      | event site, entity location  |
| `related`     | other association             | fallback                     |

Three hard rules — breaking them ruins the graph:

- **Every entity has at least one edge.** Edgeless entities float as孤立 dots.
- **Share entities across events.** The same countries/orgs must recur across events so the graph connects; otherwise it's a pile of disconnected clusters.
- **Every id referenced in `relations` must exist.** Entity ids use the `ent_` / `p_` / `org_` / `topic_` / `place_` prefixes; event ids stay `evt_N`.

See `references/graph-design.md` for methodology and good/bad examples; full field definitions in `references/schema.md`.

### Step 4 · Build

```bash
node "$SKILL/scripts/build.mjs" --data hotspot/atlas.json --out hotspot/global-hotspot-atlas.html
```

The build auto-validates first. Fix data errors and **never bypass validation**. Warnings (⚠) may be ignored at discretion, but "N entities have no relation edge" is worth fixing.

### Step 5 · Deliver

Open the generated HTML, then in 3–5 sentences explain:

- The time window and event count.
- The 2–3 most notable threads (not a per-event list).
- How to operate the map (drag to rotate, click a dot for details, press **G** for the relationship graph, press **S** to play the narrative tour).
- New-feature hints if present (click an event for "disputed accounts" / "why it's hot" / "what-if simulation").

## Data structure (quick reference)

```jsonc
{
  "meta": {
    "title", "window", "generated_at", "sources": [], "disclaimer",
    "story": { "title", "steps": [{ "eventId", "narration" }] }   // L1 narrative tour
  },
  "events": [{
    "id": "evt_1", "title", "short", "summary",
    "category": "conflict|politics|economy|tech|climate|society",
    "heat": 0-100, "severity": 1-5, "time": "ISO8601",
    "location": { "name", "lat", "lng" },
    "actors": ["ent_1", "p_2"], "topics": [], "sources": [{ "name", "title", "url" }],
    "heatReasons": ["3 major powers involved", "8 outlets same-day"],            // L3 explainable heat
    "disputes": [{ "claim", "sources": [{ "name", "stance", "quote" }] }], // L3 dispute comparison
    "simulation": { "label", "effects": [{ "eventId", "type", "desc" }] }   // L2 what-if
  }],
  "entities": [{ "id", "name", "type": "person|org|country|place|topic", "desc" }],
  "relations": [{ "source", "target", "type", "label", "weight": 1 }],
  "blindspots": [{ "name", "lat", "lng", "hint" }]                     // L3 news blindspots
}
```

## Quality red lines

1. **Facts:** headlines and summaries must be source-backed. For uncertain numbers, casualties, or names, write "reportedly" — never fabricate. Prefer wire-service wording when aggregating.
2. **Coordinates:** locate to a city or regional center — not to a building or military facility. Never mark restricted zones or publish anyone's location info.
3. **Map compliance:** the 3D globe is a **pure physical-landmass mask + dot rendering** — it draws no borders, administrative lines, or sovereignty labels, so there are no boundary-expression concerns. If a real basemap or street-level map is separately requested, switch to Tencent Maps (default proxy mode) and follow the compliance constraints in `references/visual-spec.md`.
4. **Stance:** state facts and each side's public positions only — no value judgments, no "characterizing" events.

## Scripts

| Script                      | Purpose                          | Key flags                               |
| --------------------------- | --------------------------------- | -------------------------------------- |
| `scripts/fetch.mjs`         | multi-source fetch + geocoding + dedup/score | `--hours` `--limit` `--feeds` `--out` |
| `scripts/scaffold.mjs`      | candidate pool → graph skeleton   | `--raw` `--out` `--pick`               |
| `scripts/build.mjs`        | validate + compile single-file HTML | `--data` `--out` `--check`          |
| `tools/build-landmask.py`  | regenerate land mask (maintenance only) | `--input`                         |

Self-check — confirm the environment works by building the bundled sample:

```bash
node "$SKILL/scripts/build.mjs" --data "$SKILL/assets/sample.json" --out /tmp/atlas-sample.html
```

## Troubleshooting

| Symptom                          | Cause & fix                                                       |
| -------------------------------- | ----------------------------------------------------------------- |
| `node: command not found`        | Use the absolute path; if still unavailable, collect via WebSearch + hand-write `atlas.json`, skipping Step 2. |
| All sources fail to fetch        | Network restricted. Switch to WebSearch fallback; don't get stuck on the script. |
| No dots on the globe             | Event missing `location` or illegal coords. Run `--check` to see warnings. |
| Graph is scattered dots, no edges | `relations` empty or referencing non-existent ids. Check id spelling. |
| Labels overlap each other        | Too many events. Lower `--pick` to 10–12, or merge similar events. |
| Blank page on open              | Confirm the file is complete (~130KB) and open the HTML directly in a browser. |

## Project layout

```
global-hotspot-atlas/
├── SKILL.md                 # Skill definition (workflow, rules)
├── assets/
│   ├── atlas/               # Globe + graph + tour runtime (HTML/CSS/JS)
│   ├── landmask.b64         # Prebuilt land mask
│   ├── gazetteer.json       # ~130 built-in place names + coords
│   └── sample.json          # Sample atlas for self-check
├── references/
│   ├── schema.md            # Full atlas.json field spec
│   ├── sources.md           # News sources & fetch strategy
│   ├── graph-design.md      # Entity/relation modeling methodology
│   └── visual-spec.md       # Map compliance constraints
├── scripts/
│   ├── fetch.mjs            # Multi-source collector
│   ├── scaffold.mjs         # Skeleton generator
│   └── build.mjs            # Validator + single-file builder
└── tools/
    └── build-landmask.py    # Land-mask regeneration (maintenance)
```
