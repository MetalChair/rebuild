import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, mediaURL, type Recipe, dbKey } from "../api";
import { MacroSplit, NutrientTable, NutritionFacts } from "../components/Nutrition";
import { ErrorBox, Field, Icon, Modal, NumberInput, Spinner } from "../components/ui";
import { groceryIngredients } from "../grocery";
import { useMeta } from "../meta";
import { fmt, fmtMinutes, isoDate, scaleQuantity, useAsync, useLocalStorage } from "../util";

export default function RecipeView() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const recipe = useAsync(() => api.recipe(id), [id]);
  const [servings, setServings] = useState<number | null>(null);
  const [groceryList] = useLocalStorage(dbKey("dp.groceryList"), 1);
  const [shopping, setShopping] = useState(false);
  const [shoppingError, setShoppingError] = useState("");
  const [logging, setLogging] = useState(false);
  const [tab, setTab] = useState<"label" | "all">("label");

  if (recipe.loading && !recipe.data) return <Spinner />;
  if (recipe.error || !recipe.data) return <ErrorBox error={recipe.error ?? "Not found"} onRetry={recipe.reload} />;
  const r = recipe.data;
  const target = servings ?? r.servings;
  const factor = target / r.servings;
  const n = r.nutrition;

  const addToShopping = async () => {
    setShopping(true);
    setShoppingError("");
    try {
      await api.addGroceries(groceryList, groceryIngredients(r, target));
      nav("/shopping");
    } catch (error) {
      setShoppingError(String(error));
    } finally {
      setShopping(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteRecipe(r.id);
      nav("/recipes");
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <article className="recipe">
      <div className="crumbs">
        <Link to="/recipes">Recipes</Link>
        {r.groups[0] && (
          <>
            {" › "}
            <Link to={`/recipes?group=${r.groups[0].id}`}>{r.groups[0].name}</Link>
          </>
        )}
      </div>
      <header className="recipe-head">
        {r.photo && <img className="recipe-photo" src={mediaURL(r.photo)} alt={r.name} />}
        <div className="recipe-title">
          <h1>{r.name}</h1>
          {r.subtitle && <p className="lede">{r.subtitle}</p>}
          {r.comments && <p>{r.comments}</p>}
          <dl className="facts">
            {r.prep_minutes > 0 && <Fact label="Prep" value={fmtMinutes(r.prep_minutes)} />}
            {r.cook_minutes > 0 && <Fact label="Cook" value={fmtMinutes(r.cook_minutes)} />}
            {r.ready_minutes > 0 && <Fact label="Ready in" value={fmtMinutes(r.ready_minutes)} />}
            {r.yield && <Fact label="Yield" value={r.yield} />}
            {n.per_serving.calories !== undefined && <Fact label="Per serving" value={`${fmt(n.per_serving.calories)} kcal`} />}
            {r.rating !== null && r.rating > 0 && <Fact label="Rating" value={`${fmt(r.rating, 1)} / 5`} />}
          </dl>
          {r.types && (
            <div className="chips">
              {r.types.split(",").map((t) => (
                <Link key={t} className="chip" to={`/recipes?type=${encodeURIComponent(t.trim())}`}>
                  {t.trim()}
                </Link>
              ))}
            </div>
          )}
          <div className="actions">
            <button className="btn btn-primary" onClick={() => setLogging(true)}>
              <Icon name="calendar" /> Log to diary
            </button>
            <Link className="btn" to={`/recipes/${r.id}/edit`}>
              <Icon name="edit" /> Edit
            </Link>
            <button className="btn" disabled={shopping || !r.ingredients.some(i => !i.is_heading && i.text.trim())} onClick={addToShopping}>Add ingredients to groceries</button>
            <button className="btn btn-ghost danger" onClick={remove}>
              <Icon name="trash" /> Delete
            </button>
          </div>
          {shoppingError && <ErrorBox error={shoppingError} />}
        </div>
      </header>

      <div className="recipe-cols">
        <div className="recipe-main">
          <section className="panel">
            <div className="panel-head">
              <h2>Ingredients</h2>
              <div className="stepper" aria-label="Servings">
                <button className="icon-btn" aria-label="Fewer servings" onClick={() => setServings(Math.max(1, Math.round(target) - 1))}>
                  −
                </button>
                <NumberInput className="stepper-input" value={target} min={0.25} ariaLabel="Servings" onChange={(v) => setServings(v && v > 0 ? v : null)} />
                <button className="icon-btn" aria-label="More servings" onClick={() => setServings(Math.round(target) + 1)}>
                  +
                </button>
                <span className="muted">servings</span>
              </div>
            </div>
            <ul className="ingredients">
              {r.ingredients.map((i, k) =>
                i.is_heading ? (
                  <li key={k} className="ing-heading">
                    {i.text}
                  </li>
                ) : (
                  <li key={k}>
                    <span className="ing-qty">
                      {scaleQuantity(i.quantity, factor)} {i.unit}
                    </span>{" "}
                    {i.food_id ? (
                      <Link to={`/foods/${i.food_id}`} title={i.food_name}>
                        {i.text}
                      </Link>
                    ) : (
                      i.text
                    )}
                  </li>
                ),
              )}
            </ul>
          </section>

          <section className="panel">
            <h2>Directions</h2>
            <ol className="steps">
              {r.steps.map((s, k) =>
                s.is_heading ? (
                  <li key={k} className="step-heading">
                    {s.text}
                  </li>
                ) : (
                  <li key={k}>
                    {s.text}
                    {s.photo && <img src={mediaURL(s.photo)} alt="" className="step-photo" />}
                  </li>
                ),
              )}
            </ol>
          </section>

          {(r.notes.length > 0 || r.reviews.length > 0) && (
            <section className="panel">
              {r.notes.length > 0 && (
                <>
                  <h2>Notes</h2>
                  {r.notes.map((t, k) => (
                    <p key={k}>{t}</p>
                  ))}
                </>
              )}
              {r.reviews.length > 0 && (
                <>
                  <h2>Reviews</h2>
                  {r.reviews.map((v) => (
                    <blockquote key={v.id} className="review">
                      <p>{v.text}</p>
                      <footer className="muted small">
                        {v.reviewer}
                        {v.rating ? ` · ${"★".repeat(v.rating)}` : ""}
                        {v.date && ` · ${v.date}`}
                      </footer>
                    </blockquote>
                  ))}
                </>
              )}
            </section>
          )}

          {(r.source || r.author) && (
            <p className="source muted small">
              {r.source_photo && <img src={mediaURL(r.source_photo)} alt="" />}
              {r.author && <>By {r.author}. </>}
              {r.source && <>Source: {r.source}</>}
              {r.webpage && (
                <>
                  {" · "}
                  <a href={r.webpage.startsWith("http") ? r.webpage : `https://${r.webpage}`} target="_blank" rel="noreferrer">
                    {r.webpage}
                  </a>
                </>
              )}
            </p>
          )}
        </div>

        <aside className="recipe-side">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === "label"} className={tab === "label" ? "on" : ""} onClick={() => setTab("label")}>
              Label
            </button>
            <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
              All nutrients
            </button>
          </div>
          {tab === "label" ? (
            <NutritionFacts
              values={n.per_serving}
              servings={`${fmt(r.servings, 2)} servings per recipe`}
              serving={r.serving_size || (n.serving_grams ? `1 serving (${fmt(n.serving_grams)} g)` : "1 serving")}
            />
          ) : (
            <NutrientTable values={n.per_serving} />
          )}
          <MacroSplit values={n.per_serving} />
          <p className="muted small">
            {n.mode === "label"
              ? "Nutrition from the published recipe label."
              : "Calculated from ingredients using USDA nutrient data."}
          </p>
          {n.mode === "computed" && n.missing.length > 0 && (
            <div className="notice">
              <b>Not included in the calculation:</b>
              <ul>
                {n.missing.map((m, k) => (
                  <li key={k}>{m}</li>
                ))}
              </ul>
              Link these lines to an ingredient in the editor to include them.
            </div>
          )}
        </aside>
      </div>
      {logging && <LogRecipe recipe={r} servings={factor === 1 ? 1 : factor} onClose={() => setLogging(false)} />}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LogRecipe({ recipe, servings: initial, onClose }: { recipe: Recipe; servings: number; onClose: () => void }) {
  const meta = useMeta();
  const profiles = useAsync(() => api.profiles(), []);
  const [pid, setPid] = useLocalStorage<number | null>(dbKey("dp.profile"), null);
  const [date, setDate] = useState(isoDate(new Date()));
  const [meal, setMeal] = useState(meta.meals.find((m) => m.name === "Dinner")?.id ?? meta.meals[0]?.id ?? 1);
  const [servings, setServings] = useState<number | null>(Math.round(initial * 100) / 100);
  const [status, setStatus] = useState<string>();
  const profileId = pid ?? profiles.data?.[0]?.id ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileId || !servings) return;
    try {
      await api.addEntry(profileId, date, { meal_id: meal, kind: "recipe", recipe_id: recipe.id, servings });
      setStatus("saved");
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  return (
    <Modal title={`Log “${recipe.name}”`} onClose={onClose}>
      {profiles.data && profiles.data.length === 0 ? (
        <p>
          Create a <Link to="/profiles">profile</Link> first to keep a diary.
        </p>
      ) : status === "saved" ? (
        <div className="stack">
          <p>Added to your diary.</p>
          <div className="actions">
            <Link className="btn btn-primary" to={`/diary?date=${date}`}>
              Open diary
            </Link>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <Field label="Profile">
            <select value={profileId ?? ""} onChange={(e) => setPid(Number(e.target.value))}>
              {profiles.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Meal">
            <select value={meal} onChange={(e) => setMeal(Number(e.target.value))}>
              {meta.meals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Servings" hint={recipe.nutrition.per_serving.calories !== undefined && servings ? `${fmt(recipe.nutrition.per_serving.calories * servings)} kcal` : undefined}>
            <NumberInput value={servings} min={0} onChange={setServings} />
          </Field>
          {status && <p className="error-text">{status}</p>}
          <div className="actions span-all">
            <button className="btn btn-primary" type="submit" disabled={!servings || !profileId}>
              Add to diary
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
