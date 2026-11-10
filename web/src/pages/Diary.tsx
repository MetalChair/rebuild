import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type Activity, type Day, type DayEntry, type EntryInput, type Food, type Profile, type RecipeSummary, dbKey } from "../api";
import { CaloriesChart, WeightChart } from "../components/Charts";
import { FoodPicker } from "../components/FoodPicker";
import { MacroSplit, NutrientTable } from "../components/Nutrition";
import { Empty, ErrorBox, Field, Icon, Modal, NumberInput, Spinner } from "../components/ui";
import { groceryIngredients } from "../grocery";
import { useMeta } from "../meta";
import { addDays, fmt, isoDate, kgToLb, lbToKg, longDate, useAsync, useDebounced, useLocalStorage } from "../util";

const CORE_MEALS = ["Breakfast", "Lunch", "Dinner"];

export default function DiaryPage() {
  const profiles = useAsync(() => api.profiles(), []);
  const [pid, setPid] = useLocalStorage<number | null>(dbKey("dp.profile"), null);
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? isoDate(new Date());
  const view = params.get("view") ?? "diary";
  const title = ({ calendar: "Calendar", meals: "Meal Plan", exercise: "Exercise", reports: "Reports" } as Record<string, string>)[view] ?? "Diary";
  const setDate = (d: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set("date", d);
    return next;
  }, { replace: true });

  if (profiles.loading) return <Spinner />;
  if (profiles.error) return <ErrorBox error={profiles.error} onRetry={profiles.reload} />;
  const list = profiles.data ?? [];
  if (list.length === 0)
    return (
      <div className="content content-narrow">
        <h1>{title}</h1>
        <Empty>
          The diary tracks what a profile eats each day. <Link to="/profiles">Create a profile</Link> to start.
        </Empty>
      </div>
    );
  const profile = list.find((p) => p.id === pid) ?? list[0];

  return (
    <div className="content">
      <div className="page-head diary-head">
        <h1>{title}</h1>
        <div className="row wrap">
          {list.length > 1 && (
            <select value={profile.id} onChange={(e) => setPid(Number(e.target.value))} aria-label="Profile">
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="date-nav">
            <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
              <Icon name="chevronLeft" />
            </button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
            <button className="icon-btn" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}>
              <Icon name="chevronRight" />
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setDate(isoDate(new Date()))}>
              Today
            </button>
          </div>
        </div>
      </div>
      {view === "calendar"
        ? <Calendar date={date} onPickDate={setDate} />
        : <DayView key={profile.id + date + view} profile={profile} date={date} onPickDate={setDate} view={view} />}
    </div>
  );
}

function Calendar({ date, onPickDate }: { date: string; onPickDate: (d: string) => void }) {
  const start = date.slice(0, 8) + "01";
  const first = new Date(start + "T12:00:00");
  const month = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const prev = new Date(first.getFullYear(), first.getMonth() - 1, 1, 12);
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1, 12);
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return <section className="panel content-narrow">
    <div className="panel-head">
      <button className="btn" onClick={() => onPickDate(isoDate(prev))}>Previous month</button>
      <h2>{month}</h2>
      <button className="btn" onClick={() => onPickDate(isoDate(next))}>Next month</button>
    </div>
    <div className="calendar-grid">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <strong key={d}>{d}</strong>)}
      {Array.from({ length: first.getDay() }, (_, i) => <span key={"blank" + i} />)}
      {Array.from({ length }, (_, i) => {
        const day = addDays(start, i);
        return <button className="btn" key={day} aria-pressed={day === date} aria-label={longDate(day)} onClick={() => onPickDate(day)}>{i + 1}</button>;
      })}
    </div>
    <p><Link to={"/diary?view=meals&date=" + date}>Open meal plan for {longDate(date)}</Link></p>
  </section>;
}

function DayView({ profile, date, onPickDate, view }: { profile: Profile; date: string; onPickDate: (d: string) => void; view: string }) {
  const meta = useMeta();
  const navigate = useNavigate();
  const [groceryList] = useLocalStorage(dbKey("dp.groceryList"), 1);
  const [shopping, setShopping] = useState(false);
  const day = useAsync(() => api.day(profile.id, date), [profile.id, date]);
  const [reportDays, setReportDays] = useLocalStorage("dp.reportDays", 14);
  const summary = useAsync(() => api.summary(profile.id, date, reportDays), [profile.id, date, day.data, reportDays]);
  const [units, setUnits] = useLocalStorage<"lb" | "kg">("dp.units", "lb");
  const [adding, setAdding] = useState<number | null>(null);
  const [editing, setEditing] = useState<DayEntry | null>(null);
  const [addingActivity, setAddingActivity] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string>();

  const mutate = async (fn: () => Promise<Day>) => {
    setError(undefined);
    try {
      day.setData(await fn());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (day.loading && !day.data) return <Spinner />;
  if (day.error || !day.data) return <ErrorBox error={day.error ?? "Could not load day"} onRetry={day.reload} />;
  const d = day.data;
  const eaten = d.totals.calories ?? 0;
  const budget = d.profile.budget ?? null;
  const allowance = budget !== null ? budget + d.burned : null;
  const remaining = allowance !== null ? allowance - eaten : null;
  const meals = meta.meals.filter((m) => CORE_MEALS.includes(m.name) || d.entries.some((e) => e.meal_id === m.id));
  const toUnit = (kg: number) => (units === "lb" ? kgToLb(kg) : kg);

  async function sendMealToGroceries(entries: DayEntry[]) {
    setError(undefined);
    setShopping(true);
    try {
      const rows = await Promise.all(entries.map(async entry => {
        if (entry.kind === "recipe" && entry.recipe_id) {
          const recipe = await api.recipe(entry.recipe_id);
          const ingredients = groceryIngredients(recipe, entry.servings ?? recipe.servings);
          if (ingredients.length) return ingredients;
        }
        if (entry.kind !== "text") return [{ name: entry.name, quantity: describeAmount(entry) }];
        return [];
      }));
      await api.addGroceries(groceryList, rows.flat());
      navigate("/shopping");
    } catch (error) {
      setError(String(error));
    } finally {
      setShopping(false);
    }
  }

  return (
    <>
      <p className="muted day-title">{longDate(date)}</p>
      {error && <ErrorBox error={error} />}
      <section className="summary panel" hidden={view === "exercise"}>
        <div className="summary-stats">
          <Stat label="Budget" value={budget === null ? "–" : fmt(budget)} hint={budget === null ? "Set one in Profiles" : d.profile.budget_mode === "automatic" ? "automatic" : undefined} />
          <Stat label="Eaten" value={fmt(eaten)} />
          <Stat label="Exercise" value={d.burned ? "+" + fmt(d.burned) : "0"} />
          <Stat label={remaining !== null && remaining < 0 ? "Over" : "Remaining"} value={remaining === null ? "–" : fmt(Math.abs(remaining))} tone={remaining !== null && remaining < 0 ? "over" : undefined} />
        </div>
        {allowance ? (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(allowance)} aria-valuenow={Math.round(eaten)} aria-label="Calories eaten of budget">
            <span className={"progress-fill" + (eaten > allowance ? " over" : "")} style={{ width: Math.min(100, (eaten / allowance) * 100) + "%" }} />
          </div>
        ) : null}
        <MacroSplit values={d.totals} />
      </section>

      <div className="diary-cols" hidden={view === "reports"}>
        <div hidden={view === "exercise"}>
          {meals.map((m) => {
            const entries = d.entries.filter((e) => e.meal_id === m.id);
            const kcal = entries.reduce((s, e) => s + (e.nutrients.calories ?? 0), 0);
            return (
              <section key={m.id} className="panel meal">
                <div className="panel-head">
                  <h2>{m.name}</h2>
                  <span className="muted">{entries.length ? `${fmt(kcal)} kcal` : ""}</span>
                </div>
                {entries.length > 0 && (
                  <ul className="entries">
                    {entries.map((e) => (
                      <li key={e.id}>
                        <button className="entry-main" onClick={() => e.kind !== "text" && setEditing(e)}>
                          <span className="entry-name">
                            {e.kind === "recipe" && <Icon name="book" size={14} />} {e.name}
                          </span>
                          <span className="muted small">{describeAmount(e)}</span>
                        </button>
                        <span className="entry-kcal">{e.kind === "text" ? "" : fmt(e.nutrients.calories)}</span>
                        <button className="icon-btn danger" aria-label={`Remove ${e.name}`} onClick={() => mutate(() => api.deleteEntry(e.id))}>
                          <Icon name="x" size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="btn btn-sm btn-ghost add-btn" onClick={() => setAdding(m.id)}>
                  <Icon name="plus" /> Add food
                </button>
                {entries.some(entry => entry.kind !== "text") && (
                  <button className="btn btn-sm btn-ghost" disabled={shopping} onClick={() => sendMealToGroceries(entries)}>Add meal to groceries</button>
                )}
              </section>
            );
          })}
          <div className="center">
            <select
              className="btn btn-sm"
              value=""
              aria-label="Add to another meal"
              onChange={(e) => e.target.value && setAdding(Number(e.target.value))}
            >
              <option value="">+ Add to another meal…</option>
              {meta.meals.filter((m) => !meals.includes(m)).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div hidden={view === "meals"}>
          <section className="panel">
            <div className="panel-head">
              <h2>Exercise</h2>
              <span className="muted">{d.burned ? `${fmt(d.burned)} kcal` : ""}</span>
            </div>
            {d.activities.length > 0 && (
              <ul className="entries">
                {d.activities.map((a) => (
                  <li key={a.id}>
                    <span className="entry-main">
                      <span className="entry-name">{a.name}</span>
                      <span className="muted small">{fmt(a.minutes)} min</span>
                    </span>
                    <span className="entry-kcal">{fmt(a.calories)}</span>
                    <button className="icon-btn danger" aria-label={`Remove ${a.name}`} onClick={() => mutate(() => api.deleteActivity(a.id))}>
                      <Icon name="x" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn btn-sm btn-ghost add-btn" onClick={() => setAddingActivity(true)}>
              <Icon name="plus" /> Add exercise
            </button>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Weight</h2>
              <div className="seg seg-sm">
                {(["lb", "kg"] as const).map((u) => (
                  <button key={u} className={units === u ? "on" : ""} aria-pressed={units === u} onClick={() => setUnits(u)}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <WeightInput
              key={units + (d.weight_kg ?? "")}
              valueKg={d.weight_kg}
              units={units}
              onSave={(kg) => mutate(() => api.setWeight(profile.id, date, kg))}
            />
            {d.weight_kg === null && d.profile.latest_weight_kg ? (
              <p className="muted small">Last recorded: {fmt(toUnit(d.profile.latest_weight_kg), 1)} {units}</p>
            ) : null}
          </section>

          <section className="panel">
            <h2>Note</h2>
            <NoteInput key={date} value={d.note} onSave={(t) => mutate(() => api.setNote(profile.id, date, t))} />
          </section>
        </div>
      </div>

      <section className="panel" hidden={view === "meals" || view === "exercise"}>
        <div className="panel-head">
          <h2>Last {reportDays} days</h2>
          <div className="row wrap">
            <select aria-label="Report period" value={reportDays} onChange={e => setReportDays(Number(e.target.value))}>
              {[7, 14, 30, 90].map(n => <option key={n} value={n}>{n} days</option>)}
            </select>
            <button className="btn btn-sm" disabled={!summary.data || summary.loading} onClick={() => {
              if (!summary.data) return;
              const data = ["Date,Calories eaten,Calories burned,Weight (" + units + ")",
                ...summary.data.map(row => [row.date, row.calories ?? "", row.burned, row.weight_kg == null ? "" : toUnit(row.weight_kg).toFixed(2)].join(","))].join("\r\n");
              const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = "DietPro-report-" + date + ".csv";
              link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>Export CSV</button>
          </div>
        </div>
        {summary.error && <ErrorBox error={summary.error} onRetry={summary.reload} />}
        {summary.data && (
          <div className="charts">
            <CaloriesChart days={summary.data} budget={budget} onPick={onPickDate} />
            <WeightChart days={summary.data} unit={units} toUnit={toUnit} />
          </div>
        )}
      </section>

      <section className="panel" hidden={view === "exercise"}>
        <div className="panel-head">
          <h2>Nutrient totals</h2>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            {showAll ? "Hide" : "Show"}
          </button>
        </div>
        {showAll && <NutrientTable values={d.totals} />}
      </section>

      {adding !== null && (
        <AddEntry
          mealId={adding}
          onClose={() => setAdding(null)}
          onSubmit={async (e) => {
            await mutate(() => api.addEntry(profile.id, date, e));
            setAdding(null);
          }}
        />
      )}
      {editing && (
        <EditEntry
          entry={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (e) => {
            await mutate(() => api.updateEntry(editing.id, e));
            setEditing(null);
          }}
        />
      )}
      {addingActivity && (
        <AddActivity
          hasWeight={!!d.profile.latest_weight_kg}
          onClose={() => setAddingActivity(false)}
          onSubmit={async (a) => {
            await mutate(() => api.addActivity(profile.id, date, a));
            setAddingActivity(false);
          }}
        />
      )}
    </>
  );
}

function describeAmount(e: DayEntry): string {
  if (e.kind === "recipe") return `${fmt(e.servings ?? 1, 2)} serving${e.servings === 1 ? "" : "s"}`;
  if (e.kind === "food") return `${fmt(e.measure_qty ?? 0, 2)} × ${e.measure_desc}${e.grams ? ` · ${fmt(e.grams)} g` : ""}`;
  return "";
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "over" }) {
  return (
    <div className={"stat" + (tone ? " stat-" + tone : "")}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

function WeightInput({ valueKg, units, onSave }: { valueKg: number | null; units: "lb" | "kg"; onSave: (kg: number | null) => void }) {
  const initial = valueKg === null ? null : Math.round((units === "lb" ? kgToLb(valueKg) : valueKg) * 10) / 10;
  const [v, setV] = useState<number | null>(initial);
  const dirty = v !== initial;
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v === null ? null : units === "lb" ? lbToKg(v) : v);
      }}
    >
      <NumberInput className="w-qty" value={v} min={0} ariaLabel={`Weight in ${units}`} placeholder="—" onChange={setV} />
      <span className="muted">{units}</span>
      <button className="btn btn-sm" disabled={!dirty}>
        Save
      </button>
    </form>
  );
}

function NoteInput({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [t, setT] = useState(value);
  return <textarea rows={3} value={t} placeholder="How did today go?" aria-label="Day note" onChange={(e) => setT(e.target.value)} onBlur={() => t !== value && onSave(t)} />;
}

// --- Add / edit entries ------------------------------------------------------------

function AddEntry({ mealId, onClose, onSubmit }: { mealId: number; onClose: () => void; onSubmit: (e: EntryInput) => Promise<void> }) {
  const meta = useMeta();
  const [tab, setTab] = useState<"food" | "recipe" | "text">("food");
  const [meal, setMeal] = useState(mealId);
  const [food, setFood] = useState<Food | null>(null);
  const [recipe, setRecipe] = useState<RecipeSummary | null>(null);
  const [text, setText] = useState("");
  const mealName = meta.meals.find((m) => m.id === meal)?.name ?? "";

  return (
    <Modal title={`Add to ${mealName}`} onClose={onClose}>
      <div className="seg" role="tablist">
        {(["food", "recipe", "text"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "food" ? "Ingredient" : t === "recipe" ? "Recipe" : "Note"}
          </button>
        ))}
      </div>
      <Field label="Meal">
        <select value={meal} onChange={(e) => setMeal(Number(e.target.value))}>
          {meta.meals.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      {tab === "food" &&
        (food ? (
          <FoodAmount food={food} onBack={() => setFood(null)} onSubmit={(measure_id, measure_qty) => onSubmit({ meal_id: meal, kind: "food", food_id: food.id, measure_id, measure_qty })} />
        ) : (
          <FoodPicker autoFocus onPick={(f) => api.food(f.id).then(setFood)} />
        ))}
      {tab === "recipe" &&
        (recipe ? (
          <RecipeAmount recipe={recipe} onBack={() => setRecipe(null)} onSubmit={(servings) => onSubmit({ meal_id: meal, kind: "recipe", recipe_id: recipe.id, servings })} />
        ) : (
          <RecipeSearch onPick={setRecipe} />
        ))}
      {tab === "text" && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onSubmit({ meal_id: meal, kind: "text", text });
          }}
        >
          <Field label="Note" hint="Notes don't count toward nutrition.">
            <input value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </Field>
          <div className="actions">
            <button className="btn btn-primary" disabled={!text.trim()}>
              Add note
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function FoodAmount({ food, onBack, onSubmit, initialMeasure, initialQty }: {
  food: Food;
  onBack?: () => void;
  onSubmit: (measureId: number, qty: number) => void;
  initialMeasure?: number | null;
  initialQty?: number | null;
}) {
  const [mid, setMid] = useState(initialMeasure ?? food.measures[0]?.id);
  const [qty, setQty] = useState<number | null>(initialQty ?? 1);
  const m = food.measures.find((x) => x.id === mid) ?? food.measures[0];
  const grams = (m?.grams ?? 0) * (qty ?? 0);
  const kcal = food.nutrients.calories !== undefined ? (food.nutrients.calories * grams) / 100 : null;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (m && qty !== null) onSubmit(m.id, qty);
      }}
    >
      <div className="picked">
        <b>{food.name}</b>
        {onBack && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
            Change
          </button>
        )}
      </div>
      <div className="row">
        <NumberInput className="w-qty" value={qty} min={0} ariaLabel="Quantity" onChange={setQty} />
        <select value={m?.id} onChange={(e) => setMid(Number(e.target.value))} aria-label="Measure">
          {food.measures.map((x) => (
            <option key={x.id} value={x.id}>
              {x.description} ({fmt(x.grams, 1)} g)
            </option>
          ))}
        </select>
      </div>
      <p className="preview">
        {fmt(grams)} g · <b>{kcal === null ? "–" : fmt(kcal)} kcal</b>
      </p>
      <div className="actions">
        <button className="btn btn-primary" disabled={qty === null}>
          Save
        </button>
      </div>
    </form>
  );
}

function RecipeSearch({ onPick }: { onPick: (r: RecipeSummary) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const res = useAsync(() => (dq.trim().length < 2 ? Promise.resolve(null) : api.recipes({ q: dq, limit: 15 })), [dq]);
  return (
    <div className="stack">
      <input type="search" autoFocus placeholder="Search recipes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recipes" />
      {res.data && (
        <ul className="pick-list">
          {res.data.items.map((r) => (
            <li key={r.id}>
              <button onClick={() => onPick(r)}>
                <span>{r.name}</span>
                <span className="muted">{r.calories === null ? "" : `${fmt(r.calories)} kcal/serving`}</span>
              </button>
            </li>
          ))}
          {res.data.items.length === 0 && <li className="muted">No recipes found.</li>}
        </ul>
      )}
    </div>
  );
}

function RecipeAmount({ recipe, onBack, onSubmit, initial }: { recipe: { name: string; calories: number | null }; onBack?: () => void; onSubmit: (servings: number) => void; initial?: number | null }) {
  const [servings, setServings] = useState<number | null>(initial ?? 1);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (servings !== null) onSubmit(servings);
      }}
    >
      <div className="picked">
        <b>{recipe.name}</b>
        {onBack && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
            Change
          </button>
        )}
      </div>
      <Field label="Servings">
        <NumberInput value={servings} min={0} onChange={setServings} />
      </Field>
      <p className="preview">
        <b>{recipe.calories === null || servings === null ? "–" : fmt(recipe.calories * servings)} kcal</b>
      </p>
      <div className="actions">
        <button className="btn btn-primary" disabled={servings === null}>
          Save
        </button>
      </div>
    </form>
  );
}

function EditEntry({ entry, onClose, onSubmit }: { entry: DayEntry; onClose: () => void; onSubmit: (e: EntryInput) => Promise<void> }) {
  const meta = useMeta();
  const [meal, setMeal] = useState(entry.meal_id);
  const [food, setFood] = useState<Food | null>(null);
  useEffect(() => {
    if (entry.kind === "food" && entry.food_id) api.food(entry.food_id).then(setFood);
  }, [entry]);
  const perServing = entry.servings ? (entry.nutrients.calories ?? 0) / entry.servings : null;
  return (
    <Modal title="Edit entry" onClose={onClose}>
      <Field label="Meal">
        <select value={meal} onChange={(e) => setMeal(Number(e.target.value))}>
          {meta.meals.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      {entry.kind === "food" &&
        (food ? (
          <FoodAmount
            food={food}
            initialMeasure={entry.measure_id}
            initialQty={entry.measure_qty}
            onSubmit={(measure_id, measure_qty) => onSubmit({ meal_id: meal, kind: "food", food_id: food.id, measure_id, measure_qty })}
          />
        ) : (
          <Spinner />
        ))}
      {entry.kind === "recipe" && (
        <RecipeAmount
          recipe={{ name: entry.name, calories: perServing }}
          initial={entry.servings}
          onSubmit={(servings) => onSubmit({ meal_id: meal, kind: "recipe", recipe_id: entry.recipe_id, servings })}
        />
      )}
    </Modal>
  );
}

function AddActivity({ hasWeight, onClose, onSubmit }: { hasWeight: boolean; onClose: () => void; onSubmit: (a: { activity_id: number; minutes: number; calories?: number | null }) => Promise<void> }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const list = useAsync(() => api.activities(dq), [dq]);
  const [picked, setPicked] = useState<Activity | null>(null);
  const [minutes, setMinutes] = useState<number | null>(30);
  const [calories, setCalories] = useState<number | null>(null);
  return (
    <Modal title="Add exercise" onClose={onClose}>
      {picked ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (minutes) onSubmit({ activity_id: picked.id, minutes, calories });
          }}
        >
          <div className="picked">
            <b>{picked.name}</b>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPicked(null)}>
              Change
            </button>
          </div>
          <div className="form-grid">
            <Field label="Minutes">
              <NumberInput value={minutes} min={1} onChange={setMinutes} />
            </Field>
            <Field label="Calories burned" hint={hasWeight ? "Leave blank to estimate from your weight" : "Required: no weight on record"}>
              <NumberInput value={calories} min={0} onChange={setCalories} />
            </Field>
          </div>
          <div className="actions">
            <button className="btn btn-primary" disabled={!minutes || (!hasWeight && calories === null)}>
              Add
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <input type="search" autoFocus placeholder="Search activities, e.g. walking" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activities" />
          <ul className="pick-list">
            {list.data?.map((a) => (
              <li key={a.id}>
                <button onClick={() => setPicked(a)}>
                  <span>{a.name}</span>
                  <span className="muted">{a.group}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
