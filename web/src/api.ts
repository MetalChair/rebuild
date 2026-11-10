// Typed client for the Diet Pro JSON API.

export type Nutr = Record<string, number>;

export interface NutrientDef {
  key: string;
  name: string;
  unit: string;
  category: "energy" | "macro" | "vitamin" | "mineral" | "other";
  daily_value: number | null;
}

export interface Named {
  id: number;
  name: string;
}

export interface Meta {
  meals: Named[];
  recipe_types: Named[];
  nutrients: NutrientDef[];
  counts: { recipes: number; foods: number; profiles: number };
  imported_at: string;
}

export interface CookbookGroup {
  id: number;
  parent_id: number;
  name: string;
  count: number;
}

export interface Cookbook {
  id: number;
  name: string;
  count: number;
  groups: CookbookGroup[];
}

export interface RecipeSummary {
  id: number;
  name: string;
  subtitle: string;
  photo: string;
  servings: number;
  minutes: number;
  types: string;
  rating: number | null;
  source: string;
  calories: number | null;
}

export interface Page<T> {
  total: number;
  items: T[];
}

export interface IngredientLine {
  id?: number;
  is_heading: boolean;
  quantity: string;
  unit: string;
  text: string;
  food_id: number | null;
  food_name?: string;
  measure_id: number | null;
  measure_desc?: string;
  measure_qty: number | null;
  grams?: number | null;
}

export interface Step {
  is_heading: boolean;
  text: string;
  photo: string;
}

export interface RecipeNutrition {
  mode: "computed" | "label";
  has_label: boolean;
  per_serving: Nutr;
  serving_grams: number;
  missing: string[];
}

export interface Recipe {
  id: number;
  name: string;
  subtitle: string;
  servings: number;
  yield: string;
  serving_size: string;
  comments: string;
  prep_minutes: number;
  cook_minutes: number;
  ready_minutes: number;
  author: string;
  source: string;
  webpage: string;
  photo: string;
  source_photo: string;
  types: string;
  rating: number | null;
  nutrition_mode: "computed" | "label";
  created: string;
  updated: string;
  ingredients: IngredientLine[];
  steps: Step[];
  notes: string[];
  reviews: { id: number; date: string; rating: number | null; reviewer: string; text: string }[];
  groups: { id: number; name: string; cookbook: string }[];
  nutrition: RecipeNutrition;
}

export interface FoodSummary {
  id: number;
  name: string;
  common_name: string;
  nutrition_source: string;
  is_user: boolean;
  calories: number | null;
}

export interface FoodMeasure {
  id: number;
  description: string;
  grams: number;
}

export interface Food {
  id: number;
  name: string;
  common_name: string;
  group_id: number;
  nutrition_source: string;
  is_user: boolean;
  source: string;
  webpage: string;
  comments: string;
  refuse: number | null;
  default_measure_id: number;
  nutrients: Nutr;
  measures: FoodMeasure[];
  groups: Named[];
  notes: string[];
  used_in: Named[];
}

export interface FoodGroup {
  id: number;
  parent_id: number;
  name: string;
  count: number;
}

export interface Profile {
  id: number;
  name: string;
  gender: string;
  age: number | null;
  height_cm: number | null;
  start_date: string;
  end_date: string;
  start_weight_kg: number | null;
  goal_weight_kg: number | null;
  weekly_change_kg: number;
  activity_factor: number;
  budget_mode: "manual" | "automatic";
  calorie_budget: number | null;
  comments: string;
  latest_weight_kg?: number | null;
  bmr?: number | null;
  maintenance?: number | null;
  budget?: number | null;
}

export interface DayEntry {
  id: number;
  date: string;
  meal_id: number;
  kind: "food" | "recipe" | "text";
  name: string;
  food_id: number | null;
  recipe_id: number | null;
  measure_id: number | null;
  measure_desc: string;
  measure_qty: number | null;
  servings: number | null;
  grams: number | null;
  nutrients: Nutr;
}

export interface ActivityEntry {
  id: number;
  activity_id: number;
  name: string;
  minutes: number;
  calories: number;
  comments: string;
}

export interface Day {
  date: string;
  profile: Profile;
  entries: DayEntry[];
  activities: ActivityEntry[];
  totals: Nutr;
  burned: number;
  weight_kg: number | null;
  note: string;
}

export interface EntryInput {
  meal_id: number;
  kind: "food" | "recipe" | "text";
  food_id?: number | null;
  measure_id?: number | null;
  measure_qty?: number | null;
  recipe_id?: number | null;
  servings?: number | null;
  text?: string;
}

export interface Activity {
  id: number;
  name: string;
  group: string;
  kcal_per_lb_minute: number;
}

export interface SummaryDay {
  date: string;
  calories: number | null;
  burned: number;
  weight_kg: number | null;
}

export interface GlossaryItem {
  id: number;
  name: string;
  text: string;
  source: string;
  webpage: string;
}

export interface TechniqueSummary {
  id: number;
  name: string;
  group: string;
}

export interface Technique extends TechniqueSummary {
  source: string;
  webpage: string;
  comments: string;
  steps: { text: string; photo: string; numbered: boolean }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// --- Database selection -------------------------------------------------------
// The server can serve several databases (`dietpro serve -dir`). Each browser
// tab remembers its own choice in sessionStorage and names it on every request,
// so two tabs can work on different databases without crossing over.

const DB_KEY = "dp.db";
let currentDB = "";

export interface Databases {
  databases: string[];
  current: string;
}

/** Fetch the available databases and settle which one this tab uses. Call before any other request. */
export async function initDatabases(): Promise<Databases> {
  const res = await fetch("/api/databases");
  if (!res.ok) throw new ApiError(res.status, "Could not list databases");
  const d: { databases: string[]; default: string } = await res.json();
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(DB_KEY);
  } catch {
    /* storage unavailable: use the default */
  }
  currentDB = saved && d.databases.includes(saved) ? saved : d.default;
  return { databases: d.databases, current: currentDB };
}

export const currentDatabase = () => currentDB;

/** Switch this tab to another database and reload the app from its start page. */
export function switchDatabase(name: string) {
  try {
    sessionStorage.setItem(DB_KEY, name);
  } catch {
    /* storage unavailable */
  }
  location.assign("/");
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (currentDB) (init.headers as Record<string, string>)["X-Diet-Pro-DB"] = encodeURIComponent(currentDB);
  if (body instanceof Blob) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText);
  return data as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};

export interface PantryItem extends Named {
  quantity: number;
  unit: string;
  comments: string;
}

export interface MenuRecord extends Named {
  comments: string;
  servings: number;
  lines: { id: number; name: string; kind: string; recipe_id: number | null; food_id: number | null; quantity: string }[];
}

export interface ProfilePhoto {
  id: number;
  date: string;
  caption: string;
}

export const profilePhotoURL = (profile: number, photo: number) =>
  "/api/profiles/" + profile + "/photographs/" + photo + qs({ db: currentDB });

export interface SavedLink {
  id: number;
  section: "cooking" | "exercise";
  kind: "favorite" | "search";
  title: string;
  target: string;
}

export const api = {
  savedLinks: (section: SavedLink["section"], kind: SavedLink["kind"]) =>
    request<SavedLink[]>("GET", "/api/saved" + qs({section, kind})),
  saveLink: (record: Omit<SavedLink, "id">) => request<SavedLink>("POST", "/api/saved", record),
  deleteLink: (id: number) => request<void>("DELETE", "/api/saved/" + id),
  profilePhotos: (profile: number) => request<ProfilePhoto[]>("GET", "/api/profiles/" + profile + "/photographs"),
  addProfilePhoto: (profile: number, date: string, caption: string, file: File) =>
    request<ProfilePhoto>("POST", "/api/profiles/" + profile + "/photographs" + qs({ date, caption }), file),
  deleteProfilePhoto: (profile: number, photo: number) =>
    request<void>("DELETE", "/api/profiles/" + profile + "/photographs/" + photo),
  preferences: () => request<Record<string, unknown>>("GET", "/api/preferences"),
  setPreference: (key: string, value: unknown) => request<void>("PUT", "/api/preferences/" + encodeURIComponent(key), value),
  pantry: () => request<PantryItem[]>("GET", "/api/pantry"),
  updatePantry: (id: number, quantity: number) => request<void>("PUT", "/api/pantry/" + id, { quantity }),
  menus: () => request<MenuRecord[]>("GET", "/api/menus"),
  saveMenu: (menu: MenuRecord) => menu.id
    ? request<MenuRecord>("PUT", "/api/menus/" + menu.id, menu)
    : request<MenuRecord>("POST", "/api/menus", menu),
  deleteMenu: (id: number) => request<void>("DELETE", "/api/menus/" + id),
  stores: () => request<(Named & { address: string; comments: string })[]>("GET", "/api/stores"),
  groceryLists: () => request<Named[]>("GET", "/api/grocery-lists"),
  createGroceryList: (name: string) => request<Named>("POST", "/api/grocery-lists", {name}),
  renameGroceryList: (id: number, name: string) => request<Named>("PUT", "/api/grocery-lists/" + id, {name}),
  deleteGroceryList: (id: number) => request<void>("DELETE", "/api/grocery-lists/" + id),
  groceries: (list: number) => request<{ id: number; name: string; quantity: string; checked: boolean }[]>("GET", "/api/groceries" + qs({list})),
  addGrocery: (list: number, name: string, quantity: string) => request<void>("POST", "/api/groceries" + qs({list}), [{name, quantity}]),
  addGroceries: (list: number, items: { name: string; quantity: string }[]) => request<void>("POST", "/api/groceries" + qs({list}), items),
  checkGrocery: (id: number, checked: boolean) => request<void>("PUT", `/api/groceries/${id}`, {checked}),
  deleteGrocery: (id: number) => request<void>("DELETE", `/api/groceries/${id}`),
  meta: () => request<Meta>("GET", "/api/meta"),

  cookbooks: () => request<Cookbook[]>("GET", "/api/cookbooks"),
  recipes: (p: { q?: string; group?: number; cookbook?: number; type?: string; photo?: boolean; sort?: string; limit?: number; offset?: number }) =>
    request<Page<RecipeSummary>>("GET", "/api/recipes" + qs({ ...p, photo: p.photo ? 1 : undefined })),
  recipe: (id: number) => request<Recipe>("GET", `/api/recipes/${id}`),
  createRecipe: (r: unknown) => request<Recipe>("POST", "/api/recipes", r),
  updateRecipe: (id: number, r: unknown) => request<Recipe>("PUT", `/api/recipes/${id}`, r),
  deleteRecipe: (id: number) => request<void>("DELETE", `/api/recipes/${id}`),
  uploadRecipePhoto: (id: number, file: Blob) => request<{ photo: string }>("PUT", `/api/recipes/${id}/photo`, file),
  deleteRecipePhoto: (id: number) => request<void>("DELETE", `/api/recipes/${id}/photo`),

  foodGroups: () => request<FoodGroup[]>("GET", "/api/food-groups"),
  foods: (p: { q?: string; group?: number; user?: boolean; limit?: number; offset?: number }) =>
    request<Page<FoodSummary>>("GET", "/api/foods" + qs({ ...p, user: p.user ? 1 : undefined })),
  food: (id: number) => request<Food>("GET", `/api/foods/${id}`),
  createFood: (f: unknown) => request<Food>("POST", "/api/foods", f),
  updateFood: (id: number, f: unknown) => request<Food>("PUT", `/api/foods/${id}`, f),
  deleteFood: (id: number) => request<void>("DELETE", `/api/foods/${id}`),

  profiles: () => request<Profile[]>("GET", "/api/profiles"),
  profile: (id: number) => request<Profile>("GET", `/api/profiles/${id}`),
  createProfile: (p: Partial<Profile>) => request<Profile>("POST", "/api/profiles", p),
  updateProfile: (id: number, p: Partial<Profile>) => request<Profile>("PUT", `/api/profiles/${id}`, p),
  deleteProfile: (id: number) => request<void>("DELETE", `/api/profiles/${id}`),
  summary: (id: number, end: string, days: number) => request<SummaryDay[]>("GET", `/api/profiles/${id}/summary` + qs({ end, days })),

  day: (pid: number, date: string) => request<Day>("GET", `/api/profiles/${pid}/diary/${date}`),
  addEntry: (pid: number, date: string, e: EntryInput) => request<Day>("POST", `/api/profiles/${pid}/diary/${date}/entries`, e),
  updateEntry: (id: number, e: EntryInput) => request<Day>("PUT", `/api/entries/${id}`, e),
  deleteEntry: (id: number) => request<Day>("DELETE", `/api/entries/${id}`),
  addActivity: (pid: number, date: string, a: { activity_id: number; minutes: number; calories?: number | null }) =>
    request<Day>("POST", `/api/profiles/${pid}/diary/${date}/activities`, a),
  deleteActivity: (id: number) => request<Day>("DELETE", `/api/activity-log/${id}`),
  setWeight: (pid: number, date: string, weight_kg: number | null) => request<Day>("PUT", `/api/profiles/${pid}/diary/${date}/weight`, { weight_kg }),
  setNote: (pid: number, date: string, text: string) => request<Day>("PUT", `/api/profiles/${pid}/diary/${date}/note`, { text }),
  activities: (q: string) => request<Activity[]>("GET", "/api/activities" + qs({ q })),

  glossary: () => request<GlossaryItem[]>("GET", "/api/glossary"),
  techniques: () => request<TechniqueSummary[]>("GET", "/api/techniques"),
  technique: (id: number) => request<Technique>("GET", `/api/techniques/${id}`),
};

export const mediaURL = (name: string) =>
  name ? `/media/${encodeURIComponent(name)}` + (currentDB ? `?db=${encodeURIComponent(currentDB)}` : "") : "";

/** localStorage key for a setting that belongs to the current database (e.g. the selected profile). */
export const dbKey = (key: string) => (currentDB ? `${key}:${currentDB}` : key);
