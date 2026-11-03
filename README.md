# Diet Pro (modern rebuild)

A rebuild of Radium Technologies' Diet Pro 2.0 (a ~2005 PowerBuilder/Access
Windows app) as a single self-contained binary: a Go server with an embedded
React UI and an SQLite database file. No runtime dependencies, no cgo, no
internet connection required.

```
dietpro import -csv ../DIETPRO_RECOVERY/DietProExport -images "../program files/Radium Technologies/Diet Pro/Images"
dietpro serve -open          # http://127.0.0.1:7465
```

## Features

- **Recipes** — browse by cookbook and category, search by name/ingredient/source,
  scale servings (quantities are re-fractioned: 1 1/2 → 3/4), create and edit
  recipes, link ingredient lines to the nutrient database, upload photos.
- **Nutrition** — per-serving Nutrition Facts label, 44 nutrients with % Daily
  Value, macro split. Recipes calculate from their ingredients, or keep the
  published label values that the legacy data stored for 316 recipes.
- **Ingredients** — 7,462 foods (USDA SR-13…17 plus user-entered), nutrients
  per any household measure, user-defined foods and measures.
- **Diary** — per-profile food log by meal (ingredients or recipe servings),
  exercise log (calories estimated from body weight), daily weight and notes,
  budget vs. eaten vs. burned, 14-day calorie and weight charts.
- **Profiles** — manual or automatic calorie budget (Mifflin–St Jeor × activity
  level, adjusted for planned weekly weight change).
- **Reference** — the cooking-technique library and nutrition glossary.
- Light/dark themes, responsive down to phone width.

## Building

Requires Go 1.22+ and Node 18+ (Node is only needed at build time).

```
make            # → dist/dietpro for this machine
make release    # → dist/dietpro-<version>-{darwin,linux,windows}-{amd64,arm64}
make import     # → dist/dietpro.db from the legacy export (paths overridable: LEGACY=… IMAGES=…)
make run        # build, then serve dist/dietpro.db and open a browser
make test       # go vet, Go tests (validate nutrition math against legacy values), TS typecheck
make dev        # Vite dev server with hot reload on :5173 (run `dist/dietpro serve` alongside)
```

## Importing data

`dietpro import` reads the per-table CSV export (`t_*.csv`, Windows-1252) that
the recovery produced. To import a different Diet Pro database — for example a
user's own `dp20.mdb` — convert it first:

```
scripts/mdb-to-csv.sh path/to/dp20.mdb /tmp/export     # needs mdbtools
dietpro import -csv /tmp/export -images "<Diet Pro>/Images" -db mine.db
```

The importer refuses to overwrite an existing database unless given `-force`.

### What is migrated

| Legacy | New | Notes |
|---|---|---|
| `t_ingredient` (83 wide columns) | `food` + `food_nutrient` (long format) | Blank stays unknown; it is not coerced to 0 |
| `t_measure`, `t_ingredientmeasure` | `measure`, `food_measure` | Every food also gets a 1 g measure |
| `t_recipe*`, `t_authornote`, `t_cookbook` | `recipe*`, `cookbook`, `recipe_group` | Closure tables reduced to direct links |
| `t_recipenutrition` | `recipe_label_nutrient` | Only where the legacy app used label values; computed values are recalculated live |
| `t_profile`, `t_calendarentry`, `t_calendarday`, `t_calendaractivity`, `t_calendarnote` | `profile`, `diary_entry`, `weight_log`, `activity_log`, `day_note` | Legacy budget preserved as a manual budget |
| `t_activity*`, `t_glossary*`, `t_cookingtechnique*` | `activity`, `glossary`, `technique*` | |
| `Images/` | `media` (BLOBs in the database) | Hard-coded `C:\Program Files\…` paths resolved by file name |

Not migrated yet: menus, grocery lists, pantry, stores and pricing, saved
searches/reports, publications (Word templates). The CSVs remain the source if
these are wanted later.

Ingredient IDs for USDA foods are the USDA NDB numbers, so nutrient values can
be refreshed from USDA FoodData Central "SR Legacy" by ID. New user foods get
IDs from 1,000,000 up to avoid collisions.

### Verified against the legacy app

The Go tests import the original export and check that recipe nutrition matches
the values Diet Pro stored (e.g. 15 Minute Clam Chowder: 322.73 kcal/serving)
and that daily diary totals match `t_calendarday`.

## Layout

```
main.go                 CLI: serve / import / version
internal/store          SQLite schema and nutrient catalogue
internal/importer       legacy CSV → SQLite
internal/server         JSON API, nutrition engine, SPA/media serving
web/                    React + TypeScript UI (Vite), embedded via web/embed.go
scripts/mdb-to-csv.sh   Access .mdb → CSV
```

## Notes

- The server binds to 127.0.0.1 by default and has no authentication; use
  `-addr 0.0.0.0:7465` only on a trusted network.
- The bundled recipe text and photos are third-party content (Nestlé, Better
  Homes and Gardens, etc.) shipped with the original product — fine for
  personal use, not for redistribution.
