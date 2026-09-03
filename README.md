# Remember This

An external brain that brings information back when it becomes relevant.
You write one sentence; the app decides **when** you need it again — and returns it quietly, without nagging.

```
"Ana želi Dyson fen za rođendan"          (Ana wants a Dyson hair dryer for her birthday)
   → 21.02. 19:00   Ana's birthday is in 3 weeks. Ana wants a Dyson hair dryer.
   → 07.03. 19:00   … in a week.
   → 13.03. 19:00   … tomorrow.
```

## Running (Expo Go, SDK 54)

```bash
npm install
npm start            # scan the QR code with Expo Go
```

With zero configuration the app works **100% offline** — a local rule-based enricher extracts time,
person, category and keywords. For Gemini enrichment + semantic search:

```bash
cd worker && npm install
npx wrangler kv namespace create RL      # paste the id into worker/wrangler.toml
npx wrangler secret put GEMINI_KEY
npm run dev                              # or npm run deploy
# in the repo root: cp .env.example .env  →  EXPO_PUBLIC_AI_PROXY_URL=https://...
```

## Development

```bash
npm run typecheck
npm test                       # 715 domain tests, no native modules
npm run p0 -- --heuristic      # prompt harness, local baseline
GEMINI_KEY=... npm run p0      # same against Gemini (fixtures are written by the user)
npm run brand                  # re-render icon / splash / favicon from scripts/brand/render.mjs
```

Brand assets (`assets/icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png`) are generated, not drawn:
`scripts/brand/render.mjs` holds the single bulb glyph and the lockup, writes the SVG sources to `assets/brand/`
and rasterizes the PNGs with resvg (`cd scripts/brand && npm install` once).

In the app (DEV builds): Today → *⌁ time travel* → `Seed 4 primjera`, `+1m`, `Evaluiraj Today` — you see the
surfacing moment without waiting until March.

## Documentation

`CLAUDE.md` (rules and structure) · `docs/00-PLAN.md` (milestones) · `docs/01-SCHEMA.md` · `docs/02-AI-LAYER.md` ·
`docs/03-NATIVE.md` (read before coding) · `docs/04-DESIGN.md`

UI copy is Croatian-first (the product language); documentation and code are English.
