import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, mediaURL, type Cookbook, type CookbookGroup, type RecipeSummary } from "../api";
import { Empty, ErrorBox, Icon, Spinner } from "../components/ui";
import { useMeta } from "../meta";
import { fmt, fmtMinutes, useAsync, useDebounced, useLocalStorage } from "../util";

const PAGE = 48;

export default function RecipesPage() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const group = params.get("group") ? Number(params.get("group")) : undefined;
  const cookbook = params.get("cookbook") ? Number(params.get("cookbook")) : undefined;
  const type = params.get("type") ?? "";
  const sort = params.get("sort") ?? "name";
  const [layout, setLayout] = useLocalStorage<"list" | "cards">("dp.recipeLayout", "list");
  const [text, setText] = useState(q);
  const dq = useDebounced(text, 250);
  const books = useAsync(() => api.cookbooks(), []);

  const set = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === undefined || v === "" ? next.delete(k) : next.set(k, String(v));
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (dq !== q) set({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const [items, setItems] = useState<RecipeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const key = JSON.stringify({ q, group, cookbook, type, sort });

  const load = (offset: number) => {
    setLoading(true);
    setError(undefined);
    api.recipes({ q, group, cookbook, type, sort, limit: PAGE, offset }).then(
      (p) => {
        setItems((prev) => (offset ? [...prev, ...p.items] : p.items));
        setTotal(p.total);
        setLoading(false);
      },
      (e: Error) => (setError(e.message), setLoading(false)),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(0), [key]);

  const heading = useMemo(() => {
    for (const b of books.data ?? []) {
      if (b.id === cookbook) return b.name;
      const g = b.groups.find((g) => g.id === group);
      if (g) return `${b.name} › ${g.name}`;
    }
    return "All recipes";
  }, [books.data, cookbook, group]);

  return (
    <div className="with-aside">
      <aside className="aside" aria-label="Cookbooks">
        <h2 className="aside-title">Cookbooks</h2>
        <button className={"tree-item" + (!group && !cookbook ? " active" : "")} onClick={() => set({ group: undefined, cookbook: undefined })}>
          All recipes <span className="count">{meta.counts.recipes}</span>
        </button>
        {books.error && <ErrorBox error={books.error} />}
        {books.data?.map((b) => (
          <CookbookTree key={b.id} book={b} group={group} cookbook={cookbook} onSelect={(p) => set({ group: p.group, cookbook: p.cookbook })} />
        ))}
      </aside>
      <section className="content">
        <div className="page-head">
          <div>
            <h1>{heading}</h1>
            <p className="muted">{loading && !items.length ? "Loading…" : `${total.toLocaleString()} recipes`}</p>
          </div>
          <Link className="btn btn-primary" to="/recipes/new">
            <Icon name="plus" /> New recipe
          </Link>
        </div>
        <div className="toolbar">
          <div className="search">
            <Icon name="search" />
            <input type="search" placeholder="Search name, ingredient or source…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search recipes" />
          </div>
          <select value={type} onChange={(e) => set({ type: e.target.value })} aria-label="Recipe type">
            <option value="">All types</option>
            {meta.recipe_types.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={layout} aria-label="Recipe layout" onChange={e => setLayout(e.target.value === "cards" ? "cards" : "list")}>
            <option value="list">List view</option>
            <option value="cards">Card view</option>
          </select>
          <select value={sort} onChange={(e) => set({ sort: e.target.value === "name" ? undefined : e.target.value })} aria-label="Sort">
            <option value="name">A–Z</option>
            <option value="recent">Recently updated</option>
            <option value="rating">Top rated</option>
          </select>
        </div>
        {error && <ErrorBox error={error} onRetry={() => load(0)} />}
        {!loading && !error && items.length === 0 && <Empty>No recipes match these filters.</Empty>}
        {layout === "list" ? <table className="workspace-grid recipe-list">
          <thead><tr><th>Recipe Name</th><th>Type</th><th>Calories</th></tr></thead>
          <tbody>{items.map(r => <tr key={r.id}>
            <td><Link to={"/recipes/" + r.id}>{r.name}</Link></td>
            <td>{r.types}</td>
            <td>{r.calories === null ? "—" : fmt(r.calories) + " kcal"}</td>
          </tr>)}</tbody>
        </table> : <div className="card-grid">
          {items.map(r => <RecipeCard key={r.id} r={r} />)}
        </div>}
        {loading && <Spinner />}
        {!loading && items.length < total && (
          <div className="center">
            <button className="btn" onClick={() => load(items.length)}>
              Show more ({(total - items.length).toLocaleString()} left)
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function CookbookTree({ book, group, cookbook, onSelect }: {
  book: Cookbook;
  group?: number;
  cookbook?: number;
  onSelect: (p: { group?: number; cookbook?: number }) => void;
}) {
  const containsActive = book.id === cookbook || book.groups.some((g) => g.id === group);
  const [open, setOpen] = useState(containsActive);
  const children = (parent: number): CookbookGroup[] => book.groups.filter((g) => g.parent_id === parent);
  const render = (parent: number, depth: number) =>
    children(parent).map((g) => (
      <div key={g.id}>
        <button className={"tree-item" + (g.id === group ? " active" : "")} style={{ paddingLeft: 12 + depth * 14 }} onClick={() => onSelect({ group: g.id })}>
          {g.name} {g.count > 0 && <span className="count">{g.count}</span>}
        </button>
        {render(g.id, depth + 1)}
      </div>
    ));
  return (
    <div className="tree">
      <div className="tree-book">
        <button className="icon-btn tree-toggle" aria-label={(open ? "Collapse " : "Expand ") + book.name} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? "arrowDown" : "chevronRight"} size={14} />
        </button>
        <button className={"tree-item tree-book-name" + (book.id === cookbook ? " active" : "")} onClick={() => (onSelect({ cookbook: book.id }), setOpen(true))}>
          {book.name} <span className="count">{book.count}</span>
        </button>
      </div>
      {open && render(0, 1)}
    </div>
  );
}

function RecipeCard({ r }: { r: RecipeSummary }) {
  return (
    <Link to={`/recipes/${r.id}`} className="card recipe-card">
      <div className="card-photo">
        {r.photo ? <img src={mediaURL(r.photo)} alt="" loading="lazy" /> : <span className="photo-placeholder" aria-hidden>{r.name.slice(0, 1)}</span>}
      </div>
      <div className="card-body">
        <h3>{r.name}</h3>
        <p className="muted small clamp">{r.types || r.source}</p>
        <div className="card-meta">
          {r.calories !== null && <span>{fmt(r.calories)} kcal</span>}
          {r.minutes > 0 && (
            <span>
              <Icon name="clock" size={14} /> {fmtMinutes(r.minutes)}
            </span>
          )}
          {r.rating !== null && r.rating > 0 && (
            <span>
              <Icon name="star" size={14} /> {fmt(r.rating, 1)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
