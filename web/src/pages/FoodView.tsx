import { SaveLinkButton } from "./SavedLinks";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Nutr } from "../api";
import { MacroSplit, NutrientTable, NutritionFacts } from "../components/Nutrition";
import { ErrorBox, Icon, NumberInput, Spinner } from "../components/ui";
import { fmt, useAsync } from "../util";

export default function FoodView() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const food = useAsync(() => api.food(id), [id]);
  const [measureId, setMeasureId] = useState<number | null>(null);
  const [qty, setQty] = useState<number | null>(1);

  useEffect(() => {
    if (food.data) setMeasureId(food.data.measures[0]?.id ?? null);
  }, [food.data]);

  if (food.loading && !food.data) return <Spinner />;
  if (food.error || !food.data) return <ErrorBox error={food.error ?? "Not found"} onRetry={food.reload} />;
  const f = food.data;
  const m = f.measures.find((x) => x.id === measureId) ?? f.measures[0];
  const grams = (m?.grams ?? 100) * (qty ?? 0);
  const scaled: Nutr = Object.fromEntries(Object.entries(f.nutrients).map(([k, v]) => [k, (v * grams) / 100]));

  const remove = async () => {
    if (!confirm(`Delete "${f.name}"?`)) return;
    try {
      await api.deleteFood(f.id);
      nav("/foods");
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <article className="content content-narrow">
      <div className="crumbs">
        <Link to="/foods">Ingredients</Link>
        {f.groups[0] && (
          <>
            {" › "}
            <Link to={`/foods?group=${f.groups[0].id}`}>{f.groups[0].name}</Link>
          </>
        )}
      </div>
      <div className="page-head">
        <div>
          <h1>{f.name}</h1>
          <p className="muted">
            {f.common_name && <>Also called {f.common_name} · </>}
            {f.is_user ? "Your ingredient" : `Nutrition source: ${f.nutrition_source}`}
            {f.refuse ? ` · ${fmt(f.refuse)}% refuse` : ""}
          </p>
        </div>
        <div className="actions">
            <SaveLinkButton key={f.id} record={{ section: "cooking", kind: "favorite", title: f.name, target: "/foods/" + f.id }} />
          <Link className="btn" to={`/foods/${f.id}/edit`}>
            <Icon name="edit" /> Edit
          </Link>
          {f.is_user && (
            <button className="btn btn-ghost danger" onClick={remove}>
              <Icon name="trash" /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="amount-bar panel">
        <span className="field-label">Amount</span>
        <NumberInput className="w-qty" value={qty} min={0} ariaLabel="Quantity" onChange={setQty} />
        <select value={m?.id ?? ""} onChange={(e) => setMeasureId(Number(e.target.value))} aria-label="Measure">
          {f.measures.map((x) => (
            <option key={x.id} value={x.id}>
              {x.description} ({fmt(x.grams, 1)} g)
            </option>
          ))}
        </select>
        <span className="muted">= {fmt(grams, 1)} g</span>
      </div>

      <div className="two-col">
        <div>
          <NutritionFacts values={scaled} serving={`${fmt(qty ?? 0, 2)} × ${m?.description ?? "100 g"} (${fmt(grams, 1)} g)`} />
          <MacroSplit values={scaled} />
        </div>
        <div className="panel">
          <h2>All nutrients</h2>
          <NutrientTable values={scaled} />
        </div>
      </div>

      {f.notes.length > 0 && (
        <section className="panel">
          <h2>Notes</h2>
          {f.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </section>
      )}
      {f.comments && (
        <section className="panel">
          <h2>Comments</h2>
          <p>{f.comments}</p>
        </section>
      )}
      {f.used_in.length > 0 && (
        <section className="panel">
          <h2>Used in {f.used_in.length === 50 ? "50+" : f.used_in.length} recipes</h2>
          <ul className="link-list">
            {f.used_in.map((r) => (
              <li key={r.id}>
                <Link to={`/recipes/${r.id}`}>{r.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
