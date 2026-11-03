import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Food } from "../api";
import { ErrorBox, Field, Icon, NumberInput, Spinner } from "../components/ui";
import { useMeta } from "../meta";
import { useAsync } from "../util";
import { groupOptions } from "./Foods";

const GRAM_MEASURE = 99998;

export default function FoodEdit() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const existing = useAsync(() => (id ? api.food(id) : Promise.resolve(undefined)), [id]);
  if (existing.loading) return <Spinner />;
  if (existing.error) return <ErrorBox error={existing.error} />;
  return <Editor food={existing.data} />;
}

interface MeasureRow {
  id: number;
  description: string;
  grams: number | null;
}

function Editor({ food }: { food?: Food }) {
  const meta = useMeta();
  const nav = useNavigate();
  const groups = useAsync(() => api.foodGroups(), []);
  const [name, setName] = useState(food?.name ?? "");
  const [commonName, setCommonName] = useState(food?.common_name ?? "");
  const [groupId, setGroupId] = useState(food?.group_id ?? 0);
  const [comments, setComments] = useState(food?.comments ?? "");
  const [nutrients, setNutrients] = useState<Record<string, number | null>>(food?.nutrients ?? {});
  const [measures, setMeasures] = useState<MeasureRow[]>(
    food?.measures.filter((m) => m.id !== GRAM_MEASURE).map((m) => ({ ...m })) ?? [{ id: 0, description: "1 serving", grams: null }],
  );
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    // Send every catalogue key so cleared fields are removed server-side.
    const body = {
      name,
      common_name: commonName,
      group_id: groupId,
      comments,
      source: food?.source ?? "",
      webpage: food?.webpage ?? "",
      default_measure_id: food?.default_measure_id ?? 0,
      nutrients: Object.fromEntries(meta.nutrients.map((n) => [n.key, nutrients[n.key] ?? null])),
      measures: measures.filter((m) => m.grams && m.grams > 0).map((m) => ({ id: m.id, description: m.description, grams: m.grams })),
    };
    try {
      const saved = food ? await api.updateFood(food.id, body) : await api.createFood(body);
      nav(`/foods/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const cats: [string, string][] = [
    ["energy", "Energy"],
    ["macro", "Macronutrients"],
    ["vitamin", "Vitamins"],
    ["mineral", "Minerals"],
    ["other", "Other"],
  ];

  return (
    <form className="editor content-narrow" onSubmit={save}>
      <div className="crumbs">
        <Link to="/foods">Ingredients</Link> › {food ? <Link to={`/foods/${food.id}`}>{food.name}</Link> : "New"}
      </div>
      <div className="page-head">
        <h1>{food ? "Edit ingredient" : "New ingredient"}</h1>
        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {food && !food.is_user && (
        <div className="notice">This is a USDA reference ingredient. Changes affect every recipe and diary entry that uses it.</div>
      )}
      {error && <ErrorBox error={error} />}

      <section className="panel form-grid">
        <Field label="Name" className="span-all">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Common name">
          <input value={commonName} onChange={(e) => setCommonName(e.target.value)} />
        </Field>
        <Field label="Group">
          <select value={groupId} onChange={(e) => setGroupId(Number(e.target.value))}>
            <option value={0}>—</option>
            {groupOptions(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Comments" className="span-all">
          <textarea rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
        </Field>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Measures</h2>
          <span className="muted small">Grams per measure. Weight in grams is always available.</span>
        </div>
        {measures.map((m, i) => (
          <div className="measure-row" key={i}>
            <input
              aria-label="Measure description"
              placeholder="e.g. 1 cup, chopped"
              value={m.description}
              disabled={m.id !== 0}
              onChange={(e) => setMeasures(measures.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))}
            />
            <NumberInput className="w-qty" min={0} value={m.grams} ariaLabel="Grams" onChange={(v) => setMeasures(measures.map((x, k) => (k === i ? { ...x, grams: v } : x)))} />
            <span className="muted">g</span>
            <button type="button" className="icon-btn danger" aria-label="Remove measure" onClick={() => setMeasures(measures.filter((_, k) => k !== i))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setMeasures([...measures, { id: 0, description: "", grams: null }])}>
          <Icon name="plus" /> Measure
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Nutrients per 100 g</h2>
          <span className="muted small">Leave blank when unknown — blank is not the same as zero.</span>
        </div>
        {cats.map(([c, label]) => (
          <fieldset key={c} className="nutrient-grid">
            <legend>{label}</legend>
            {meta.nutrients
              .filter((n) => n.category === c)
              .map((n) => (
                <Field key={n.key} label={`${n.name} (${n.unit})`}>
                  <NumberInput min={0} value={nutrients[n.key] ?? null} onChange={(v) => setNutrients({ ...nutrients, [n.key]: v })} />
                </Field>
              ))}
          </fieldset>
        ))}
      </section>
    </form>
  );
}
