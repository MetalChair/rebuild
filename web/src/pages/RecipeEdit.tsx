import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, mediaURL, type FoodMeasure, type IngredientLine, type Recipe, type Step } from "../api";
import { FoodPicker } from "../components/FoodPicker";
import { ErrorBox, Field, Icon, NumberInput, Spinner } from "../components/ui";
import { useMeta } from "../meta";
import { parseQuantity, useAsync } from "../util";

type Draft = Omit<Recipe, "id" | "nutrition" | "reviews" | "groups" | "created" | "updated" | "photo" | "source_photo"> & {
  group_ids: number[];
};

const blankIngredient = (): IngredientLine => ({ is_heading: false, quantity: "", unit: "", text: "", food_id: null, measure_id: null, measure_qty: null });
const blankStep = (): Step => ({ is_heading: false, text: "", photo: "" });

function toDraft(r?: Recipe): Draft {
  return {
    name: r?.name ?? "",
    subtitle: r?.subtitle ?? "",
    servings: r?.servings ?? 4,
    yield: r?.yield ?? "",
    serving_size: r?.serving_size ?? "",
    comments: r?.comments ?? "",
    prep_minutes: r?.prep_minutes ?? 0,
    cook_minutes: r?.cook_minutes ?? 0,
    ready_minutes: r?.ready_minutes ?? 0,
    author: r?.author ?? "",
    source: r?.source ?? "",
    webpage: r?.webpage ?? "",
    types: r?.types ?? "",
    rating: r?.rating ?? null,
    nutrition_mode: r?.nutrition_mode ?? "computed",
    ingredients: r?.ingredients.length ? r.ingredients : [blankIngredient()],
    steps: r?.steps.length ? r.steps : [blankStep()],
    notes: r?.notes ?? [],
    group_ids: r?.groups.map((g) => g.id) ?? [],
  };
}

export default function RecipeEdit() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const existing = useAsync(() => (id ? api.recipe(id) : Promise.resolve(undefined)), [id]);
  if (existing.loading) return <Spinner />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  return <Editor recipe={existing.data} />;
}

function Editor({ recipe }: { recipe?: Recipe }) {
  const meta = useMeta();
  const nav = useNavigate();
  const books = useAsync(() => api.cookbooks(), []);
  const [d, setD] = useState<Draft>(() => toDraft(recipe));
  const [measures, setMeasures] = useState<Record<number, FoodMeasure[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [photo, setPhoto] = useState(recipe?.photo ?? "");

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const setIng = (i: number, patch: Partial<IngredientLine>) =>
    setD((p) => ({ ...p, ingredients: p.ingredients.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  const setStep = (i: number, patch: Partial<Step>) => setD((p) => ({ ...p, steps: p.steps.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  const move = <T,>(list: T[], i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };

  const loadMeasures = (foodId: number) => {
    if (measures[foodId]) return Promise.resolve(measures[foodId]);
    return api.food(foodId).then((f) => {
      setMeasures((m) => ({ ...m, [foodId]: f.measures }));
      return f.measures;
    });
  };
  useEffect(() => {
    const ids = new Set(d.ingredients.map((i) => i.food_id).filter((x): x is number => !!x));
    ids.forEach((fid) => loadMeasures(fid));
    // Only on first render; later links load their own measures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeList = d.types.split(",").map((t) => t.trim()).filter(Boolean);
  const toggleType = (t: string) => set("types", (typeList.includes(t) ? typeList.filter((x) => x !== t) : [...typeList, t]).join(", "));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const saved = recipe ? await api.updateRecipe(recipe.id, d) : await api.createRecipe(d);
      nav(`/recipes/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File | undefined) => {
    if (!file || !recipe) return;
    try {
      const res = await api.uploadRecipePhoto(recipe.id, file);
      setPhoto(res.photo);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="editor" onSubmit={save}>
      <div className="crumbs">
        <Link to="/recipes">Recipes</Link> › {recipe ? <Link to={`/recipes/${recipe.id}`}>{recipe.name}</Link> : "New"}
      </div>
      <div className="page-head">
        <h1>{recipe ? "Edit recipe" : "New recipe"}</h1>
        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save recipe"}
          </button>
        </div>
      </div>
      {error && <ErrorBox error={error} />}

      <section className="panel form-grid">
        <Field label="Name" className="span-all">
          <input value={d.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Subtitle" className="span-all">
          <input value={d.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
        </Field>
        <Field label="Description" className="span-all">
          <textarea rows={2} value={d.comments} onChange={(e) => set("comments", e.target.value)} />
        </Field>
        <Field label="Servings">
          <NumberInput value={d.servings} min={0.25} onChange={(v) => set("servings", v ?? 1)} />
        </Field>
        <Field label="Serving size" hint='e.g. "1 cup"'>
          <input value={d.serving_size} onChange={(e) => set("serving_size", e.target.value)} />
        </Field>
        <Field label="Prep (min)">
          <NumberInput value={d.prep_minutes} min={0} step="1" onChange={(v) => set("prep_minutes", v ?? 0)} />
        </Field>
        <Field label="Cook (min)">
          <NumberInput value={d.cook_minutes} min={0} step="1" onChange={(v) => set("cook_minutes", v ?? 0)} />
        </Field>
        <Field label="Ready in (min)">
          <NumberInput value={d.ready_minutes} min={0} step="1" onChange={(v) => set("ready_minutes", v ?? 0)} />
        </Field>
        <Field label="Yield">
          <input value={d.yield} onChange={(e) => set("yield", e.target.value)} />
        </Field>
        <Field label="Author">
          <input value={d.author} onChange={(e) => set("author", e.target.value)} />
        </Field>
        <Field label="Source">
          <input value={d.source} onChange={(e) => set("source", e.target.value)} />
        </Field>
        <Field label="Web page" className="span-all">
          <input value={d.webpage} onChange={(e) => set("webpage", e.target.value)} />
        </Field>
        <fieldset className="span-all">
          <legend className="field-label">Types</legend>
          <div className="chips">
            {meta.recipe_types.map((t) => (
              <button type="button" key={t.id} className={"chip" + (typeList.includes(t.name) ? " chip-on" : "")} aria-pressed={typeList.includes(t.name)} onClick={() => toggleType(t.name)}>
                {t.name}
              </button>
            ))}
          </div>
        </fieldset>
        {recipe && (
          <div className="span-all photo-field">
            <span className="field-label">Photo</span>
            <div className="row">
              {photo ? <img src={mediaURL(photo)} alt="" className="thumb" /> : <span className="thumb thumb-empty"><Icon name="photo" /></span>}
              <label className="btn">
                Upload…
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
              </label>
              {photo && (
                <button type="button" className="btn btn-ghost" onClick={() => api.deleteRecipePhoto(recipe.id).then(() => setPhoto(""))}>
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Ingredients</h2>
          <span className="muted small">Link a line to an ingredient to include it in the nutrition calculation.</span>
        </div>
        <div className="ing-edit-list">
          {d.ingredients.map((ing, i) => (
            <div key={i} className={"ing-edit" + (ing.is_heading ? " is-heading" : "")}>
              <div className="ing-edit-row">
                {!ing.is_heading && (
                  <>
                    <input
                      className="w-qty"
                      placeholder="Qty"
                      aria-label="Quantity"
                      value={ing.quantity}
                      onChange={(e) => setIng(i, { quantity: e.target.value, measure_qty: ing.food_id ? parseQuantity(e.target.value) : ing.measure_qty })}
                    />
                    <input className="w-unit" placeholder="Unit" aria-label="Unit" value={ing.unit} onChange={(e) => setIng(i, { unit: e.target.value })} />
                  </>
                )}
                <input
                  className="grow"
                  placeholder={ing.is_heading ? "Section heading (e.g. For the sauce)" : "Ingredient text, e.g. celery stalks, chopped"}
                  aria-label="Ingredient text"
                  value={ing.text}
                  onChange={(e) => setIng(i, { text: e.target.value })}
                />
                <RowTools
                  onUp={() => set("ingredients", move(d.ingredients, i, -1))}
                  onDown={() => set("ingredients", move(d.ingredients, i, 1))}
                  onRemove={() => set("ingredients", d.ingredients.filter((_, k) => k !== i))}
                />
              </div>
              {!ing.is_heading && (
                <div className="ing-edit-link">
                  {ing.food_id ? (
                    <>
                      <span className="linked">
                        <Icon name="leaf" size={14} /> <Link to={`/foods/${ing.food_id}`}>{ing.food_name || `#${ing.food_id}`}</Link>
                      </span>
                      <span className="muted">counts as</span>
                      <NumberInput className="w-qty" value={ing.measure_qty} min={0} ariaLabel="Measure quantity" onChange={(v) => setIng(i, { measure_qty: v })} />
                      <select aria-label="Measure" value={ing.measure_id ?? ""} onChange={(e) => setIng(i, { measure_id: Number(e.target.value) })}>
                        {!measures[ing.food_id]?.some((m) => m.id === ing.measure_id) && <option value={ing.measure_id ?? ""}>{ing.measure_desc || "—"}</option>}
                        {measures[ing.food_id]?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.description} ({m.grams} g)
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIng(i, { food_id: null, food_name: "", measure_id: null, measure_qty: null })}>
                        Unlink
                      </button>
                    </>
                  ) : (
                    <FoodPicker
                      placeholder="Link to ingredient…"
                      onPick={async (f) => {
                        const ms = await loadMeasures(f.id);
                        setIng(i, {
                          food_id: f.id,
                          food_name: f.name,
                          measure_id: ms[0]?.id ?? null,
                          measure_desc: ms[0]?.description,
                          measure_qty: parseQuantity(ing.quantity) ?? 1,
                          text: ing.text || f.name,
                        });
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={() => set("ingredients", [...d.ingredients, blankIngredient()])}>
            <Icon name="plus" /> Ingredient
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => set("ingredients", [...d.ingredients, { ...blankIngredient(), is_heading: true }])}>
            <Icon name="plus" /> Heading
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Directions</h2>
        {d.steps.map((s, i) => (
          <div key={i} className="step-edit">
            <span className="step-num">{s.is_heading ? "§" : d.steps.slice(0, i + 1).filter((x) => !x.is_heading).length}</span>
            <textarea rows={s.is_heading ? 1 : 3} aria-label={`Step ${i + 1}`} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} />
            <RowTools
              onUp={() => set("steps", move(d.steps, i, -1))}
              onDown={() => set("steps", move(d.steps, i, 1))}
              onRemove={() => set("steps", d.steps.filter((_, k) => k !== i))}
            />
          </div>
        ))}
        <div className="actions">
          <button type="button" className="btn btn-sm" onClick={() => set("steps", [...d.steps, blankStep()])}>
            <Icon name="plus" /> Step
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => set("steps", [...d.steps, { ...blankStep(), is_heading: true }])}>
            <Icon name="plus" /> Heading
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Notes</h2>
        <textarea rows={3} value={d.notes.join("\n\n")} onChange={(e) => set("notes", e.target.value.split(/\n\s*\n/))} aria-label="Notes" placeholder="Tips, variations, substitutions…" />
      </section>

      <section className="panel">
        <h2>Nutrition</h2>
        <label className="check">
          <input type="radio" name="mode" checked={d.nutrition_mode === "computed"} onChange={() => set("nutrition_mode", "computed")} /> Calculate from ingredients
        </label>
        <label className="check">
          <input
            type="radio"
            name="mode"
            disabled={!recipe?.nutrition.has_label}
            checked={d.nutrition_mode === "label"}
            onChange={() => set("nutrition_mode", "label")}
          />{" "}
          Use published label values {!recipe?.nutrition.has_label && <span className="muted">(none stored for this recipe)</span>}
        </label>
      </section>

      <section className="panel">
        <h2>Cookbooks</h2>
        {books.data?.map((b) => (
          <fieldset key={b.id} className="book-groups">
            <legend>{b.name}</legend>
            <div className="chips">
              {b.groups.map((g) => {
                const on = d.group_ids.includes(g.id);
                return (
                  <button
                    type="button"
                    key={g.id}
                    className={"chip" + (on ? " chip-on" : "")}
                    aria-pressed={on}
                    onClick={() => set("group_ids", on ? d.group_ids.filter((x) => x !== g.id) : [...d.group_ids, g.id])}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </section>

      <div className="actions sticky-actions">
        <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save recipe"}
        </button>
      </div>
    </form>
  );
}

function RowTools({ onUp, onDown, onRemove }: { onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <span className="row-tools">
      <button type="button" className="icon-btn" aria-label="Move up" onClick={onUp}>
        <Icon name="arrowUp" size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label="Move down" onClick={onDown}>
        <Icon name="arrowDown" size={16} />
      </button>
      <button type="button" className="icon-btn danger" aria-label="Remove" onClick={onRemove}>
        <Icon name="trash" size={16} />
      </button>
    </span>
  );
}
