import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, dbKey, type Named } from "../api";
import { ErrorBox, Modal, Spinner } from "../components/ui";
import { useAsync, useLocalStorage } from "../util";
import { SaveLinkButton, SaveSearch } from "./SavedLinks";

export function Home() {
  return <article className="content workspace-home">
    <h1>Welcome to Diet Pro!</h1>
    <h2>Where Do I Start?</h2>
    <ol>
      <li><Link to="/profiles">Create a profile.</Link> Set your calorie budget and weight goals.</li>
      <li><Link to="/diary?view=meals">Plan your meals.</Link> Add ingredients and recipes by serving size.</li>
      <li><Link to="/diary?view=exercise">Record exercise.</Link> Find an activity and enter its duration.</li>
      <li><Link to="/diary">Keep a diary.</Link> Record your weight and notes for the day.</li>
      <li><Link to="/diary?view=reports">View your progress.</Link> Review calorie and weight charts.</li>
    </ol>
    <h2>Diet Workspace</h2>
    <p>Use the tabs beneath the navigation tree to switch sections.</p>
    <dl>
      <dt>Profile</dt><dd>Calendar, meal plan, exercise, goals, diary and reports.</dd>
      <dt>Cooking</dt><dd>Cookbooks, ingredients, glossary and illustrated cooking techniques.</dd>
      <dt>Shopping</dt><dd>Keep and print grocery lists.</dd>
      <dt>Exercise</dt><dd>Browse the activity catalog.</dd>
    </dl>
    <Link to="/help">Contents and Index</Link>
  </article>;
}

export function Help() {
  return <article className="content workspace-home">
    <h1>Contents and Index</h1>
    <h2>Getting Started</h2>
    <p>Open Profiles to create a profile or edit the sample. Use Calendar to select a date. Open Meal Plan and choose Add food under the meal. The picker accepts catalog ingredients, recipes, or a text note.</p>
    <h2>Cooking and Shopping</h2>
    <p>Browse Cookbooks or search by recipe name. Open a recipe to view its ingredients, instructions, and nutrition. Grocery Lists lets you create, rename, and print checklists. Recipes and meal plans send items to the currently selected list.</p>
    <h2>Exercise and Reports</h2>
    <p>In Profile → Exercise, select an activity and enter its duration. If you have recorded your weight, Diet Pro can estimate calories burned. Reports shows recent calorie and weight history.</p>
    <h2>Moving your data</h2>
    <p>Use File → Exit Diet Pro before copying the executable and DietPro.db together to another writable folder. First launch in a folder without a database starts with the bundled catalog. File → Back up database saves a copy that includes your committed changes. To open a backup, copy DietPro.exe into a fresh folder and place the backup beside it under the name DietPro.db.</p>
    <h2>Original manual</h2>
    <p>The legacy installation includes Diet Pro 2005 Help under Help → Contents and Index.</p>
  </article>;
}

export function Internet() {
  return <article className="content workspace-home">
    <h1>Internet Reference</h1>
    <p>Diet Pro works offline. The local <Link to="/reference?tab=glossary">glossary</Link> and <Link to="/reference">cooking techniques</Link> are available under Cooking.</p>
  </article>;
}

export function Activities() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (q: string) => setParams(q ? {q} : {}, {replace: true});
  const activities = useAsync(() => api.activities(""), []);
  const rows = (activities.data ?? []).filter(a => a.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="content content-narrow">
    <div className="page-head"><h1>Activities</h1><SaveSearch section="exercise" title={query} /><Link className="btn" to="/diary?view=exercise">Record exercise</Link></div>
    <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Filter activities" placeholder="Find an activity…" />
    {activities.loading && <Spinner />}
    {activities.error && <ErrorBox error={activities.error} />}
    <table className="workspace-grid"><thead><tr><th>Activity Name</th><th>Favorite</th></tr></thead><tbody>
      {rows.map(activity => <tr key={activity.id}><td>{activity.name}</td><td>
        <SaveLinkButton compact record={{ section: "exercise", kind: "favorite", title: activity.name, target: "/activities?q=" + encodeURIComponent(activity.name) }} />
      </td></tr>)}
    </tbody></table>
    <p className="muted">{rows.length} records</p>
  </section>;
}

export function Shopping() {
  const lists = useAsync(() => api.groceryLists(), []);
  const [selected, setSelected] = useLocalStorage(dbKey("dp.groceryList"), 1);
  const [editor, setEditor] = useState<"new" | "rename" | null>(null);
  const [listName, setListName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const records = lists.data ?? [];
  const current = records.find(list => list.id === selected) ?? records[0];

  async function update(action: () => Promise<{ selected: number; records: Named[] }>) {
    setBusy(true);
    setError("");
    try {
      const next = await action();
      lists.setData(next.records);
      setSelected(next.selected);
      setEditor(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (lists.loading && !current) return <Spinner />;
  if (!current) return <ErrorBox error={lists.error ?? "No grocery lists found."} onRetry={lists.reload} />;

  return <section className="content content-narrow">
    <div className="page-head"><h1>{current.name}</h1><button className="btn no-print" onClick={() => window.print()}>Print</button></div>
    <div className="row wrap no-print grocery-lists">
      <select aria-label="Grocery list" value={current.id} disabled={busy} onChange={e => {
        setError("");
        setSelected(Number(e.target.value));
      }}>{lists.data?.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
      <button className="btn" disabled={busy} onClick={() => { setError(""); setListName(""); setEditor("new"); }}>New list</button>
      <button className="btn" disabled={busy} onClick={() => { setError(""); setListName(current.name); setEditor("rename"); }}>Rename</button>
      {current.id !== 1 && <button className="btn danger" disabled={busy} onClick={() => {
        if (!confirm("Delete " + current.name + " and all its items?")) return;
        void update(async () => {
          await api.deleteGroceryList(current.id);
          return { selected: 1, records: records.filter(list => list.id !== current.id) };
        });
      }}>Delete list</button>}
    </div>
    {error && !editor && <ErrorBox error={error} />}
    <GroceryItems key={current.id} listID={current.id} />
    {editor && <Modal title={editor === "new" ? "New grocery list" : "Rename grocery list"} onClose={() => { if (!busy) setEditor(null); }}>
      <form className="stack" onSubmit={e => {
        e.preventDefault();
        if (busy || !listName.trim()) return;
        void update(async () => {
          const saved = editor === "new" ? await api.createGroceryList(listName) : await api.renameGroceryList(current.id, listName);
          return { selected: saved.id, records: editor === "new" ? [...records, saved] : records.map(list => list.id === saved.id ? saved : list) };
        });
      }}>
        <label>List name<input autoFocus required maxLength={120} value={listName} onChange={e => setListName(e.target.value)} /></label>
        {error && <ErrorBox error={error} />}
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !listName.trim()}>{editor === "new" ? "Create list" : "Save name"}</button>
          <button className="btn" type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
        </div>
      </form>
    </Modal>}
  </section>;
}

function GroceryItems({ listID }: { listID: number }) {
  const list = useAsync(() => api.groceries(listID), [listID]);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      await action();
      after?.();
      list.setData(await api.groceries(listID));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  return <>
    <form className="row wrap no-print grocery-form" onSubmit={e => {
      e.preventDefault();
      if (!name.trim()) return;
      void change(() => api.addGrocery(listID, name, quantity), () => { setName(""); setQuantity(""); });
    }}>
      <input aria-label="Grocery item" placeholder="Grocery item" required maxLength={200} value={name} onChange={e => setName(e.target.value)} />
      <input aria-label="Quantity" placeholder="Quantity" maxLength={80} value={quantity} onChange={e => setQuantity(e.target.value)} />
      <button className="btn btn-primary" disabled={busy || !name.trim()}>Add item</button>
    </form>
    {list.loading && <Spinner />}
    {(error || list.error) && <ErrorBox error={error || list.error!} />}
    <table className="workspace-grid groceries">
      <thead><tr><th>Got it</th><th>Item</th><th>Quantity</th><th className="no-print">Action</th></tr></thead>
      <tbody>{(list.data ?? []).map(item => <tr key={item.id}>
        <td><input type="checkbox" checked={item.checked} disabled={busy} aria-label={item.name} onChange={e => {
          const checked = e.target.checked;
          void change(() => api.checkGrocery(item.id, checked));
        }} /></td>
        <td>{item.name}</td><td>{item.quantity}</td>
        <td className="no-print"><button className="btn btn-sm" disabled={busy} onClick={() => change(() => api.deleteGrocery(item.id))}>Remove</button></td>
      </tr>)}</tbody>
    </table>
    {list.data?.length === 0 && <p className="muted">Add an item to start your grocery list.</p>}
  </>;
}

export function Stores() {
  const stores = useAsync(() => api.stores(), []);
  return <section className="content content-narrow">
    <h1>Stores</h1>
    {stores.loading && <Spinner />}
    {stores.error && <ErrorBox error={stores.error} />}
    {stores.data?.map(store => <article className="panel" key={store.id}>
      <h2>{store.name}</h2>
      {store.address && <p>{store.address}</p>}
      {store.comments && <p>{store.comments}</p>}
    </article>)}
  </section>;
}

export function Inventory() {
  const pantry = useAsync(() => api.pantry(), []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const rows = (pantry.data ?? []).filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="content content-narrow">
    <h1>Inventory</h1>
    <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Filter inventory" placeholder="Find a pantry item…" />
    {pantry.loading && <Spinner />}
    {(error || pantry.error) && <ErrorBox error={error || pantry.error!} />}
    <table className="workspace-grid"><thead><tr><th>Item</th><th>Unit</th><th>On hand</th></tr></thead>
      <tbody>{rows.map(item => <tr key={item.id}>
        <td title={item.comments}>{item.name}</td><td>{item.unit}</td>
        <td><Stock key={item.quantity} name={item.name} saved={item.quantity} save={async quantity => {
          setError("");
          try {
            await api.updatePantry(item.id, quantity);
            pantry.reload();
          } catch (err) {
            setError(String(err));
          }
        }} /></td>
      </tr>)}</tbody>
    </table>
    <p className="muted">{rows.length} records</p>
  </section>;
}

function Stock({ name, saved, save }: { name: string; saved: number; save: (quantity: number) => Promise<void> }) {
  const [value, setValue] = useState(String(saved));
  const [busy, setBusy] = useState(false);
  return <form className="row" onSubmit={async event => {
    event.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try { await save(Number(value)); } finally { setBusy(false); }
  }}>
    <input type="number" className="w-qty" min="0" step="any" required aria-label={name + " on hand"} value={value} onChange={event => setValue(event.target.value)} />
    <button className="btn btn-sm" disabled={busy || Number(value) === saved}>Save</button>
  </form>;
}
