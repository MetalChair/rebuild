import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type MenuRecord } from "../api";
import { Empty, ErrorBox, Field, Spinner } from "../components/ui";
import { useAsync, useDebounced } from "../util";

type MenuLine = MenuRecord["lines"][number];
const newMenu = (): MenuRecord => ({ id: 0, name: "", comments: "", servings: 1, lines: [] });

export default function MenusPage() {
  const menus = useAsync(() => api.menus(), []);
  const [editing, setEditing] = useState<MenuRecord | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const records = menus.data ?? [];

  async function remove(menu: MenuRecord) {
    if (!confirm("Delete " + menu.name + "?")) return;
    setRemoving(menu.id);
    setError("");
    try {
      await api.deleteMenu(menu.id);
      menus.setData(records.filter(record => record.id !== menu.id));
    } catch (err) {
      setError(String(err));
    } finally {
      setRemoving(null);
    }
  }

  return <section className="content content-narrow">
    <div className="page-head">
      <h1>{editing ? (editing.id ? "Edit menu" : "New menu") : "Menus"}</h1>
      {!editing && <button className="btn btn-primary" disabled={removing !== null || menus.loading} onClick={() => setEditing(newMenu())}>New menu</button>}
    </div>
    {editing ? <MenuEditor record={editing} cancel={() => setEditing(null)} saved={menu => {
      const next = records.filter(record => record.id !== menu.id).concat(menu);
      menus.setData(next.sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
    }} /> : <>
      {menus.loading && <Spinner />}
      {(error || menus.error) && <ErrorBox error={error || menus.error!} />}
      {!menus.loading && records.length === 0 && <Empty>Create a menu to group recipes and courses.</Empty>}
      {records.map(menu => <article className="panel" key={menu.id}>
        <div className="panel-head">
          <h2>{menu.name}</h2>
          <div className="row wrap">
            <button className="btn btn-sm" disabled={removing !== null} onClick={() => setEditing(menu)}>Edit</button>
            <button className="btn btn-sm danger" disabled={removing !== null} onClick={() => void remove(menu)}>Delete</button>
          </div>
        </div>
        <p>{menu.comments} {menu.servings} {menu.servings === 1 ? "serving" : "servings"}.</p>
        <ul className="ingredients">{menu.lines.map(line => <li key={line.id} className={line.kind === "Heading" ? "ing-heading" : undefined}>
          {line.quantity && <span className="ing-qty">{line.quantity} </span>}
          {line.recipe_id ? <Link to={"/recipes/" + line.recipe_id}>{line.name}</Link>
            : line.food_id ? <Link to={"/foods/" + line.food_id}>{line.name}</Link> : line.name}
        </li>)}</ul>
      </article>)}
    </>}
  </section>;
}

function MenuEditor({ record, saved, cancel }: { record: MenuRecord; saved: (menu: MenuRecord) => void; cancel: () => void }) {
  const [draft, setDraft] = useState(record);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const serial = useRef(-1);
  const term = useDebounced(query.trim(), 200);
  const recipes = useAsync(() => term ? api.recipes({ q: term, limit: 8 }) : Promise.resolve(null), [term]);

  function add(kind: string, name = "", recipeID: number | null = null) {
    const line: MenuLine = { id: serial.current--, name, kind, recipe_id: recipeID, food_id: null, quantity: "" };
    setDraft(d => ({ ...d, lines: [...d.lines, line] }));
  }
  function edit(id: number, key: "name" | "quantity", value: string) {
    setDraft(d => ({ ...d, lines: d.lines.map(line => line.id === id ? { ...line, [key]: value } : line) }));
  }
  function move(from: number, to: number) {
    setDraft(d => {
      const lines = [...d.lines];
      const [line] = lines.splice(from, 1);
      lines.splice(to, 0, line);
      return { ...d, lines };
    });
  }

  return <form className="stack" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try { saved(await api.saveMenu(draft)); }
    catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }}>
    <Field label="Menu name">
      <input value={draft.name} required maxLength={160} onChange={e => setDraft({ ...draft, name: e.target.value })} />
    </Field>
    <Field label="Servings">
      <input type="number" min="0.01" max="10000" step="any" required value={draft.servings || ""} onChange={e => setDraft({ ...draft, servings: Number(e.target.value) })} />
    </Field>
    <Field label="Notes">
      <textarea value={draft.comments} maxLength={4000} rows={3} onChange={e => setDraft({ ...draft, comments: e.target.value })} />
    </Field>
    <h2>Menu items</h2>
    {draft.lines.map((line, index) => <div key={line.id} className="menu-edit-row">
      <label>{line.kind}<input aria-label={line.kind + " " + (index + 1)} value={line.name} required maxLength={240} onChange={e => edit(line.id, "name", e.target.value)} /></label>
      {line.kind !== "Heading" && <label>Quantity<input aria-label={"Quantity for item " + (index + 1)} value={line.quantity} maxLength={80} onChange={e => edit(line.id, "quantity", e.target.value)} /></label>}
      <div className="row">
        <button type="button" className="btn btn-sm" aria-label={"Move item " + (index + 1) + " up"} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>
        <button type="button" className="btn btn-sm" aria-label={"Move item " + (index + 1) + " down"} disabled={index + 1 === draft.lines.length} onClick={() => move(index, index + 1)}>↓</button>
        <button type="button" className="btn btn-sm danger" onClick={() => setDraft(d => ({ ...d, lines: d.lines.filter(l => l.id !== line.id) }))}>Remove</button>
      </div>
    </div>)}
    <div className="row wrap">
      <button type="button" className="btn" disabled={draft.lines.length >= 150} onClick={() => add("Heading")}>Add course heading</button>
      <button type="button" className="btn" disabled={draft.lines.length >= 150} onClick={() => add("Text")}>Add text item</button>
    </div>
    <Field label="Find a recipe to add">
      <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recipes…" />
    </Field>
    {term && recipes.error && <ErrorBox error={recipes.error} />}
    {!!term && term === query.trim() && !recipes.loading && <ul className="menu-search-results">
      {recipes.data?.items.map(recipe => <li key={recipe.id}>
        <button className="btn btn-sm" type="button" disabled={draft.lines.length >= 150} onClick={() => { add("Recipe", recipe.name, recipe.id); setQuery(""); }}>Add {recipe.name}</button>
      </li>)}
    </ul>}
    {error && <ErrorBox error={error} />}
    <div className="row">
      <button className="btn btn-primary" disabled={busy || !draft.name.trim()}>Save menu</button>
      <button type="button" className="btn" disabled={busy} onClick={cancel}>Cancel</button>
    </div>
  </form>;
}
