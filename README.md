# Diet Pro (modern rebuild)

A rebuild of Radium Technologies' Diet Pro 2.0 (a ~2005 PowerBuilder/Access
Windows app) as a single self-contained binary: a Go server with an embedded
React UI and an SQLite database file. No runtime dependencies, no cgo, no
internet connection required.

**Contents**

1. [Running Diet Pro (no programming needed)](#1-running-diet-pro-no-programming-needed)
2. [Using Claude to understand and work on this repository](#2-using-claude-to-understand-and-work-on-this-repository)
3. [Technical reference](#technical-reference): features, building, importing, layout

---

## 1. Running Diet Pro (no programming needed)

The app is already built for you, and comes with a ready-made database that
holds all the recipes, foods, profiles and diary entries migrated from the
original Diet Pro. You do **not** need to install anything (no Go, no Node,
no database server). Diet Pro runs as a small program on your computer and
you use it through your normal web browser. Nothing is sent over the internet.

### Step 1: Get the files

1. Go to the repository page on GitHub (https://github.com/MetalChair/rebuild).
2. Click the green **Code** button, then **Download ZIP**.
3. Find the ZIP in your Downloads folder and open it (double-click) to unzip it.
4. Open the unzipped folder, then open the **`dist`** folder inside it.

The `dist` folder holds everything you need:

| File | What it is |
|---|---|
| `dietpro.db` | **The database** with all your migrated data. Keep it safe. |
| `dietpro.db-shm`, `dietpro.db-wal` | Helper files that belong to the database. Keep them next to it. |
| `dietpro-…-darwin-arm64` | The app for **Macs with Apple chips** (M1, M2, M3, M4…) |
| `dietpro-…-darwin-amd64` | The app for **older Macs with Intel chips** |
| `dietpro-…-windows-amd64.exe` | The app for **Windows** PCs |
| `dietpro-…-linux-amd64` / `-linux-arm64` | The app for **Linux** (regular PCs / ARM boards such as a Raspberry Pi) |
| `dietpro` | A copy of the Apple-chip Mac app (you can ignore it) |

(`…` is the build date, for example `2026.11.02`.)

> **Which Mac do I have?** Click the Apple menu → **About This Mac**.
> If it says **Chip: Apple M…**, use `darwin-arm64`. If it says
> **Processor: Intel…**, use `darwin-amd64`.

**Important:** the app looks for a file called `dietpro.db` **in the folder it
is started from**. Keep the app and `dietpro.db` together in the same folder,
and follow the steps below exactly. If the app can't find the database it
quietly starts with an **empty** one, and you'll see no recipes. See
[Troubleshooting](#troubleshooting) if that happens.

You may move the whole `dist` folder somewhere permanent (for example your
Documents folder) and rename it to something like `Diet Pro`. Just keep its
contents together.

### Step 2: Start the app

#### On Windows

1. In the `dist` folder, double-click **`dietpro-…-windows-amd64.exe`**.
2. Windows may show a blue box saying *"Windows protected your PC"*. This
   appears because the app isn't from a registered publisher. Click
   **More info**, then **Run anyway**.
3. A black window opens with a line like:
   ```
   Diet Pro 2026.11.02 serving dietpro.db at http://127.0.0.1:7465
   ```
   **Leave this window open.** It is the app. Closing it stops Diet Pro.
4. If Windows asks whether to allow network access, you can click **Cancel**.
   The app only talks to your own computer.
5. Go on to [Step 3](#step-3-open-diet-pro-in-your-browser).

#### On a Mac

On a Mac, **don't double-click the app.** The Mac would start it from your home
folder, where it can't find the database. Use the Terminal app instead. It
only takes three commands:

1. Open **Terminal**: press **⌘ Command + Space**, type `Terminal`, press **Return**.
2. Type `cd` followed by **one space** (don't press Return yet). Then drag the
   `dist` folder from Finder onto the Terminal window. Its location is filled
   in for you. Now press **Return**. It should look something like:
   ```
   cd /Users/you/Downloads/rebuild-main/dist
   ```
3. Copy one of these lines into Terminal and press **Return**:
   - Apple-chip Mac:
     ```
     xattr -c dietpro-*-darwin-arm64 ; chmod +x dietpro-*-darwin-arm64 ; ./dietpro-*-darwin-arm64 -open
     ```
   - Intel Mac:
     ```
     xattr -c dietpro-*-darwin-amd64 ; chmod +x dietpro-*-darwin-amd64 ; ./dietpro-*-darwin-amd64 -open
     ```

   (The first two parts tell macOS the downloaded app is OK to run. The last
   part starts it. `-open` opens your browser automatically.)
4. Terminal shows a line like
   `Diet Pro 2026.11.02 serving dietpro.db at http://127.0.0.1:7465` and your
   browser should open Diet Pro. **Leave the Terminal window open**. Closing it
   stops the app.

If macOS still says the app *"cannot be opened because the developer cannot be
verified"*, open **System Settings → Privacy & Security**, scroll down, click
**Open Anyway** next to the message about `dietpro`, then repeat step 3.

Next time you only need steps 1, 2 and the last part of step 3, for example
`./dietpro-*-darwin-arm64 -open`.

#### On Linux

Open a terminal in the `dist` folder (in most file managers: right-click inside
the folder → **Open in Terminal**) and run:

```
chmod +x dietpro-*-linux-amd64 && ./dietpro-*-linux-amd64 -open
```

(Use `linux-arm64` instead on a Raspberry Pi or other ARM computer.)

### Step 3: Open Diet Pro in your browser

If your browser didn't open on its own, open any browser (Chrome, Safari, Edge,
Firefox) and type this into the address bar:

```
http://127.0.0.1:7465
```

You should see Diet Pro with the migrated recipes, cookbooks, ingredients,
profiles and diary already in it. Bookmark the page for next time. (The page
only works while the app is running; see Step 4.)

Use the menu to move between **Recipes**, **Foods**, **Diary**, **Profiles**
and **Reference**. Everything you add or change is saved straight away into
`dietpro.db`. There is no Save button to remember.

### Step 4: Stop the app

When you're done, close the browser tab. Then either close the black
window / Terminal window, or click into it and press **Ctrl + C**. Next time,
repeat Step 2 and Step 3.

### Back up your data

All of your data lives in `dietpro.db` (plus its `-shm`/`-wal` helper files).
To make a backup, **stop the app first**, then copy those files to a safe place
such as a USB stick or cloud drive. To restore, stop the app and copy them back.

### Troubleshooting

| Problem | What to do |
|---|---|
| The app opens but there are **no recipes / everything is empty** | The app was started from the wrong folder and made a new empty database. Stop it and start it again exactly as in Step 2. On a Mac, make sure you did the `cd` step, and don't double-click. You can delete any stray empty `dietpro.db` it created elsewhere (e.g. in your home folder). Never delete the one in `dist`. |
| The terminal says **`Note: dietpro.db does not exist; starting with an empty database`** | Same cause as above: the app can't see `dietpro.db` in the current folder. |
| **`address already in use`** | Diet Pro (or something else) is already running. Use the window that's already open, or close it first. To run on a different address, add `-addr 127.0.0.1:7466` to the start command and open `http://127.0.0.1:7466`. |
| The browser says **"This site can't be reached"** | The app isn't running. Start it (Step 2) and keep its window open. |
| Mac: **`no such file or directory`** or **`permission denied`** | You're in the wrong folder or used the wrong chip version. Redo step 2 of the Mac instructions, and check which Mac you have. |
| Mac: **"cannot be opened because the developer cannot be verified"** | See the note at the end of the Mac instructions (System Settings → Privacy & Security → Open Anyway). |

Diet Pro only listens on your own computer, so other people on your network
can't reach it. It has no password, so don't change that unless you know what
you're doing (see [Notes](#notes)).

---

## 2. Using Claude to understand and work on this repository

[Claude Code](https://claude.com/claude-code) is an AI assistant that works
directly with the files in this folder. It can read and explain the code, answer
questions about the data, run the app and the tests, and make changes for you.
You describe what you want in plain English and don't need to know Go,
TypeScript or SQL yourself.

### Set up

1. **Get a Claude account.** A Claude Pro or Max subscription, or an Anthropic
   Console (API) account, is needed for Claude Code.
2. **Install Claude Code.** Choose whichever of these you prefer:
   - **Desktop app**: download Claude for Mac or Windows from
     https://claude.com/download and open the **Code** tab.
   - **VS Code / JetBrains**: install the "Claude Code" extension from your
     editor's extension marketplace.
   - **Terminal**:
     - macOS / Linux: `curl -fsSL https://claude.ai/install.sh | bash`
     - Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
3. **Get the repository with git** (preferred over the ZIP so you can review
   and undo Claude's changes):
   ```
   git clone https://github.com/MetalChair/rebuild.git
   cd rebuild
   ```
   (If you only have the ZIP, the unzipped folder works too. You just won't
   have version history.)
4. **Open Claude in the repository folder.** In a terminal, `cd` into the
   folder and run `claude`. In the desktop app or editor, open the folder.
   Sign in when asked.

### Give Claude context the first time

Claude reads files as it needs them, but it works better with a short project
briefing. In your first session, type:

```
/init
```

Claude explores the repository and writes a `CLAUDE.md` file summarising the
architecture, commands and conventions. It reads this automatically at the start
of every later session. Review it, correct anything wrong, and commit it. Some
things worth adding by hand:

- Use `dist/dietpro.db` as the working database, and back it up before
  changing data.
- `make test` must pass before a change is considered done.
- Nutrition math is checked against the legacy app's stored values (see
  "Verified against the legacy app" below), so changes there need extra care.

### Things you can ask

**Understanding the project**
- "Give me a tour of this repository. What does each folder do?"
- "How is a recipe's nutrition calculated? Walk me through it with 15 Minute Clam Chowder."
- "What legacy Diet Pro tables were migrated, and what was left behind?"
- "Explain the database schema in `internal/store/schema.sql` in plain English."

**Running and checking things**
- "Start the app with the bundled database and tell me the URL."
- "Run the tests and tell me whether everything passes."
- "How many recipes and foods are in `dist/dietpro.db`? Which cookbooks have the most recipes?"

**Making changes**
- "Add a field for prep time to recipes and show it on the recipe page."
- "Migrate the legacy grocery lists. They're listed under 'Not migrated yet'."
- "Rebuild the release binaries for all platforms."

Claude asks permission before running commands or editing files. You can see
each change before accepting it.

### Tips

- **Be specific about the goal**, not the implementation: "recipes with no
  photo should show a placeholder" works better than naming files.
- **Ask for a plan first** on bigger changes ("plan this, don't change anything
  yet"). Or press **Shift + Tab** to switch to plan mode.
- **Protect your data.** The database holds your real diary and profile data.
  Copy `dist/dietpro.db` somewhere safe before asking Claude to change data or
  the importer. If you use git, `git diff` and `git restore` show and undo
  code changes.
- **Building needs tools** that running doesn't: Go 1.22+ and Node 18+.
  Claude can check whether they're installed and help install them.
- **Stop the app** (or ask Claude to) before replacing binaries or the
  database file.

---

# Technical reference

```
dietpro import -csv ../DIETPRO_RECOVERY/DietProExport -images "../program files/Radium Technologies/Diet Pro/Images"
dietpro serve -open          # http://127.0.0.1:7465
```

`dietpro serve` flags: `-db` (default `dietpro.db` in the current directory),
`-addr` (default `127.0.0.1:7465`), `-open` (launch the default browser).
`serve` is the default command, so `dietpro -open` is equivalent.

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
