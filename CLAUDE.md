# Working on Dârülmülk

A city-management game set in 13th-century Konya, drawn as an Ottoman/Seljuk miniature.
Design, rules and roadmap live in `docs/TASARIM.md` (Turkish); read it before adding a
feature and update its phase table when a phase lands.

## Conventions

- **Player-facing text is Turkish**; code, identifiers and comments are English.
- **`src/sim/` must not import three.js, `src/render/` or `src/ui/`.** ESLint enforces it.
  Simulation state is plain typed arrays in `CityState`; views rebuild when the matching
  `city.revision` counter changes, so bump it whenever a layer is mutated.
- **Determinism:** generation draws from `createRng(def.seed)`; per-tile visual variation
  uses `hash2(x, z, salt)` so it never depends on unrelated changes.
- **World units:** one tile = one unit ≈ 10 m; origin at the map centre, x east, z south.
- **Rendering:** every lit material comes from `miniMaterial()` (flat miniature shading
  with zoom-blended shadows). Outlines are produced in `MiniPipeline` from depth, normals
  and an ink class (`setInkClass`); overlays that must not be inked use `markOverlay`.
  Static geometry goes through `PartBatch` so it merges into a few draw calls.
- Tuning data belongs in `data/*.json`, not in code.

## Checks

`npm run check` (typecheck, lint, prettier, vitest) must pass before committing.
`npm run test:e2e` builds the game and plays it in Chromium; set `CHROMIUM_PATH` to use a
preinstalled browser. It fails on any console error or rejected WebGL draw.
