import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, mediaURL } from "../api";
import { Empty, ErrorBox, Icon, Spinner } from "../components/ui";
import { useAsync } from "../util";

export default function ReferencePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "glossary" ? "glossary" : "techniques";
  return (
    <div className="content">
      <div className="page-head">
        <h1>Reference</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === "techniques"} className={tab === "techniques" ? "on" : ""} onClick={() => setParams({})}>
            Cooking techniques
          </button>
          <button role="tab" aria-selected={tab === "glossary"} className={tab === "glossary" ? "on" : ""} onClick={() => setParams({ tab: "glossary" })}>
            Glossary
          </button>
        </div>
      </div>
      {tab === "techniques" ? <Techniques /> : <Glossary />}
    </div>
  );
}

function Techniques() {
  const list = useAsync(() => api.techniques(), []);
  const [id, setId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const detail = useAsync(() => (id ? api.technique(id) : Promise.resolve(null)), [id]);
  const groups = useMemo(() => {
    const out = new Map<string, { id: number; name: string }[]>();
    for (const t of list.data ?? []) {
      if (q && !t.name.toLowerCase().includes(q.toLowerCase())) continue;
      const g = t.group || "Other";
      out.set(g, [...(out.get(g) ?? []), t]);
    }
    return [...out.entries()];
  }, [list.data, q]);

  if (list.loading) return <Spinner />;
  if (list.error) return <ErrorBox error={list.error} />;
  return (
    <div className="with-aside">
      <aside className="aside">
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter techniques" />
        </div>
        {groups.map(([g, items]) => (
          <div key={g}>
            <h3 className="aside-title">{g}</h3>
            {items.map((t) => (
              <button key={t.id} className={"tree-item" + (t.id === id ? " active" : "")} onClick={() => setId(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="content-narrow">
        {!id && <Empty>Pick a technique to read it.</Empty>}
        {detail.loading && id && <Spinner />}
        {detail.data && (
          <article className="panel technique">
            <p className="muted small">{detail.data.group}</p>
            <h2>{detail.data.name}</h2>
            {detail.data.comments && <p className="lede">{detail.data.comments}</p>}
            {detail.data.steps.map((s, i) => (
              <div key={i} className="technique-step">
                {s.photo && <img src={mediaURL(s.photo)} alt="" />}
                <p>{s.text}</p>
              </div>
            ))}
            {detail.data.source && <p className="muted small">Source: {detail.data.source}</p>}
          </article>
        )}
      </section>
    </div>
  );
}

function Glossary() {
  const list = useAsync(() => api.glossary(), []);
  const [q, setQ] = useState("");
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list.data ?? []).filter((g) => !t || g.name.toLowerCase().includes(t) || g.text.toLowerCase().includes(t));
  }, [list.data, q]);
  if (list.loading) return <Spinner />;
  if (list.error) return <ErrorBox error={list.error} />;
  return (
    <div className="content-narrow">
      <div className="search">
        <Icon name="search" />
        <input type="search" placeholder={`Search ${list.data?.length ?? ""} terms…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search glossary" autoFocus />
      </div>
      {items.length === 0 && <Empty>No matching terms.</Empty>}
      <dl className="glossary">
        {items.slice(0, 200).map((g) => (
          <div key={g.id}>
            <dt>{g.name}</dt>
            <dd>
              {g.text.split("\n\n").map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {g.source && <p className="muted small">Source: {g.source}</p>}
            </dd>
          </div>
        ))}
      </dl>
      {items.length > 200 && <p className="muted">Showing 200 of {items.length}. Refine your search to see more.</p>}
    </div>
  );
}
