-- Diet Pro modern schema. Nutrient amounts are stored in long format:
-- food_nutrient is per 100 g of edible portion; recipe_label_nutrient is per serving.

CREATE TABLE IF NOT EXISTS nutrient (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL,
  category    TEXT NOT NULL,
  daily_value REAL,
  sort        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS food_group (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL DEFAULT 0,
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS food (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  common_name      TEXT NOT NULL DEFAULT '',
  group_id         INTEGER NOT NULL DEFAULT 0,
  nutrition_source TEXT NOT NULL DEFAULT '',
  is_user          INTEGER NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT '',
  webpage          TEXT NOT NULL DEFAULT '',
  comments         TEXT NOT NULL DEFAULT '',
  refuse           REAL,
  photo            TEXT NOT NULL DEFAULT '',
  default_measure_id INTEGER NOT NULL DEFAULT 0,
  aisle            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS food_group_idx ON food(group_id);

CREATE TABLE IF NOT EXISTS food_group_member (
  group_id INTEGER NOT NULL,
  food_id  INTEGER NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, food_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS fgm_food_idx ON food_group_member(food_id);

CREATE TABLE IF NOT EXISTS food_nutrient (
  food_id  INTEGER NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  nutrient TEXT NOT NULL,
  amount   REAL NOT NULL,
  PRIMARY KEY (food_id, nutrient)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS measure (
  id            INTEGER PRIMARY KEY,
  description   TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT '',
  unit_singular TEXT NOT NULL DEFAULT '',
  unit_plural   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS food_measure (
  food_id    INTEGER NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  measure_id INTEGER NOT NULL,
  grams      REAL NOT NULL,
  PRIMARY KEY (food_id, measure_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS food_note (
  id      INTEGER PRIMARY KEY,
  food_id INTEGER NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  idx     INTEGER NOT NULL,
  text    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cookbook (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  comments  TEXT NOT NULL DEFAULT '',
  author    TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recipe_group (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER NOT NULL DEFAULT 0,
  cookbook_id INTEGER NOT NULL,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  subtitle       TEXT NOT NULL DEFAULT '',
  servings       REAL NOT NULL DEFAULT 1,
  yield          TEXT NOT NULL DEFAULT '',
  serving_size   TEXT NOT NULL DEFAULT '',
  comments       TEXT NOT NULL DEFAULT '',
  prep_minutes   INTEGER NOT NULL DEFAULT 0,
  cook_minutes   INTEGER NOT NULL DEFAULT 0,
  ready_minutes  INTEGER NOT NULL DEFAULT 0,
  author         TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT '',
  webpage        TEXT NOT NULL DEFAULT '',
  photo          TEXT NOT NULL DEFAULT '',
  source_photo   TEXT NOT NULL DEFAULT '',
  types          TEXT NOT NULL DEFAULT '',
  rating         REAL,
  -- 'computed' derives nutrition from ingredients; 'label' uses recipe_label_nutrient.
  nutrition_mode TEXT NOT NULL DEFAULT 'computed',
  created        TEXT NOT NULL DEFAULT '',
  updated        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recipe_group_member (
  group_id  INTEGER NOT NULL,
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, recipe_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS rgm_recipe_idx ON recipe_group_member(recipe_id);

CREATE TABLE IF NOT EXISTS recipe_ingredient (
  id          INTEGER PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  is_heading  INTEGER NOT NULL DEFAULT 0,
  quantity    TEXT NOT NULL DEFAULT '',
  unit        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  food_id     INTEGER,
  measure_id  INTEGER,
  measure_qty REAL
);
CREATE INDEX IF NOT EXISTS ri_recipe_idx ON recipe_ingredient(recipe_id);
CREATE INDEX IF NOT EXISTS ri_food_idx ON recipe_ingredient(food_id);

CREATE TABLE IF NOT EXISTS recipe_step (
  id         INTEGER PRIMARY KEY,
  recipe_id  INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  is_heading INTEGER NOT NULL DEFAULT 0,
  text       TEXT NOT NULL,
  photo      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS rs_recipe_idx ON recipe_step(recipe_id);

CREATE TABLE IF NOT EXISTS recipe_note (
  id        INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  text      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_review (
  id        INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  date      TEXT NOT NULL DEFAULT '',
  rating    INTEGER,
  reviewer  TEXT NOT NULL DEFAULT '',
  text      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recipe_label_nutrient (
  recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  nutrient  TEXT NOT NULL,
  amount    REAL NOT NULL,
  PRIMARY KEY (recipe_id, nutrient)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS recipe_type (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  abbr TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS profile (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  gender          TEXT NOT NULL DEFAULT '',
  age             INTEGER,
  height_cm       REAL,
  start_date      TEXT NOT NULL DEFAULT '',
  end_date        TEXT NOT NULL DEFAULT '',
  start_weight_kg REAL,
  goal_weight_kg  REAL,
  -- Planned weekly change in kg (negative to lose).
  weekly_change_kg REAL NOT NULL DEFAULT 0,
  activity_factor REAL NOT NULL DEFAULT 1.2,
  -- 'manual' uses calorie_budget; 'automatic' derives it from weight, height, age and plan.
  budget_mode     TEXT NOT NULL DEFAULT 'manual',
  calorie_budget  REAL,
  comments        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS weight_log (
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  PRIMARY KEY (profile_id, date)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS day_note (
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (profile_id, date)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS diary_entry (
  id          INTEGER PRIMARY KEY,
  profile_id  INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  meal_id     INTEGER NOT NULL,
  idx         INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL, -- 'food' | 'recipe' | 'text'
  food_id     INTEGER,
  measure_id  INTEGER,
  measure_qty REAL,
  recipe_id   INTEGER,
  servings    REAL,
  text        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS diary_day_idx ON diary_entry(profile_id, date);

CREATE TABLE IF NOT EXISTS activity_group (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL DEFAULT 0,
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  group_id           INTEGER NOT NULL DEFAULT 0,
  kcal_per_lb_minute REAL NOT NULL,
  source             TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY,
  profile_id  INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  activity_id INTEGER NOT NULL,
  minutes     REAL NOT NULL,
  calories    REAL NOT NULL,
  comments    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS activity_day_idx ON activity_log(profile_id, date);

CREATE TABLE IF NOT EXISTS glossary (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT '',
  webpage TEXT NOT NULL DEFAULT '',
  text    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS technique (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT '',
  webpage    TEXT NOT NULL DEFAULT '',
  comments   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS technique_step (
  id           INTEGER PRIMARY KEY,
  technique_id INTEGER NOT NULL REFERENCES technique(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  text         TEXT NOT NULL,
  photo        TEXT NOT NULL DEFAULT '',
  numbered     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media (
  name TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
