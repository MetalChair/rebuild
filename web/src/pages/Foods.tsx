import { SaveSearch } from "./SavedLinks";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type FoodGroup, type FoodSummary } from "../api";
import { Empty, ErrorBox, Icon, Spinner } from "../components/ui";
import { fmt, useAsync, useDebounced } from "../util";

const PAGE = 50;

/** Flattens the group tree into indented <option>s. */
export function groupOptions(groups: FoodGroup[]) {
  const out: { id: number; label: string }[] = [];
  const walk = (parent: number, depth: number) =>
    groups
      .filter((g) => g.parent_id === parent)
      .forEach((g) => {
        out.push({ id: g.id, label: "  ".repeat(depth) + g.name });
        walk(g.id, depth + 1);
      });
  walk(0, 0);
  return out;
}

export default function FoodsPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const group = params.get("group") ? Number(params.get("group")) : undefined;
  const user = params.get("user") === "1";
  const [text, setText] = useState(q);
  const dq = useDebounced(text, 250);
  const groups = useAsync(() => api.foodGroups(), []);

  const set = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === undefined || v === "" ? next.delete(k) : next.set(k, String(v));
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (dq !== q) set({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const [items, setItems] = useState<FoodSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = (offset: number) => {
    setLoading(true);
    setError(undefined);
    api.foods({ q, group, user, limit: PAGE, offset }).then(
      (p) => (setItems((prev) => (offset ? [...prev, ...p.items] : p.items)), setTotal(p.total), setLoading(false)),
      (e: Error) => (setError(e.message), setLoading(false)),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(0), [q, group, user]);

  return (
    <div className="content content-narrow">
      <div className="page-head">
        <div>
          <h1>Ingredients</h1>
          <p className="muted">Nutrition per 100 g, from USDA SR data plus your own ingredients.</p>
        </div>
        <Link className="btn btn-primary" to="/foods/new">
          <Icon name="plus" /> New ingredient
        </Link>
      </div>
      <div className="toolbar">
          <SaveSearch section="cooking" title={q || "Ingredient search"} />
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder="Search, e.g. “cheddar” or “chicken breast roasted”" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search ingredients" autoFocus />
        </div>
        <select value={group ?? ""} onChange={(e) => set({ group: e.target.value || undefined })} aria-label="Food group">
          <option value="">All groups</option>
          {groupOptions(groups.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={user} onChange={(e) => set({ user: e.target.checked ? "1" : undefined })} /> Mine only
        </label>
      </div>
      {error && <ErrorBox error={error} onRetry={() => load(0)} />}
      {!loading && !error && items.length === 0 && <Empty>No ingredients found.</Empty>}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="list-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">kcal / 100 g</th>
                <th className="hide-sm">Source</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} onClick={() => nav(`/foods/${f.id}`)} className="clickable">
                  <td>
                    <Link to={`/foods/${f.id}`}>{f.name}</Link>
                    {f.common_name && <span className="muted small"> · {f.common_name}</span>}
                  </td>
                  <td className="num">{fmt(f.calories)}</td>
                  <td className="hide-sm muted small">{f.is_user ? <span className="badge">Mine</span> : f.nutrition_source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <Spinner />}
      {!loading && items.length < total && (
        <div className="center">
          <button className="btn" onClick={() => load(items.length)}>
            Show more ({(total - items.length).toLocaleString()} left)
          </button>
        </div>
      )}
    </div>
  );
}
