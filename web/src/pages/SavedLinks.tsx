import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, type SavedLink } from "../api";
import { ErrorBox, Spinner } from "../components/ui";
import { useAsync } from "../util";

export function SaveLinkButton({ record, compact = false }: { record: Omit<SavedLink, "id">; compact?: boolean }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const label = record.kind === "favorite" ? "Save favorite" : "Save search";
  return <>
    <button type="button" className={compact ? "btn btn-sm" : "btn"} title={label} aria-label={label + " " + record.title} disabled={busy} onClick={async () => {
      const title = record.kind === "search" ? window.prompt("Name this search", record.title) : record.title;
      if (!title?.trim()) return;
      setBusy(true);
      setStatus("");
      try {
        await api.saveLink({ ...record, title });
        setStatus("Saved");
      } catch (err) {
        setStatus(String(err));
      } finally {
        setBusy(false);
      }
    }}>{compact ? "☆" : label}</button>
    {status && <span role="status" className="small">{status}</span>}
  </>;
}

export function SaveSearch({ section, title }: { section: SavedLink["section"]; title: string }) {
  const location = useLocation();
  if (!location.search) return null;
  return <SaveLinkButton key={location.search} record={{ section, kind: "search", title, target: location.pathname + location.search }} />;
}

export default function SavedLinksPage({ section, kind }: Pick<SavedLink, "section" | "kind">) {
  const records = useAsync(() => api.savedLinks(section, kind), [section, kind]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const title = (section === "cooking" ? "Cooking" : "Exercise") + (kind === "favorite" ? " Favorites" : " Searches");

  async function remove(id: number) {
    setBusy(true);
    setError("");
    try {
      await api.deleteLink(id);
      records.setData((records.data ?? []).filter(item => item.id !== id));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return <section className="content content-narrow">
    <h1>{title}</h1>
    {records.loading && <Spinner />}
    {(error || records.error) && <ErrorBox error={error || records.error!} />}
    {!records.loading && records.data?.length === 0 && <p>Use {kind === "favorite" ? "Save favorite" : "Save search"} while browsing the catalog.</p>}
    {!!records.data?.length && <table className="workspace-grid"><thead><tr><th>Name</th><th>Action</th></tr></thead>
      <tbody>{records.data.map(item => <tr key={item.id}>
        <td><Link to={item.target}>{item.title}</Link></td>
        <td><button className="btn btn-sm" disabled={busy} onClick={() => void remove(item.id)}>Remove</button></td>
      </tr>)}</tbody>
    </table>}
  </section>;
}
