import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "../components/ui";

type ImportResult = {
  url: string;
  profiles: number;
  entries: number;
  recipes: number;
};

export default function ImportAccessPage() {
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const [source, setSource] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  async function convert(file: File) {
    setError("");
    setResult(null);
    if (!file.name.toLowerCase().endsWith(".mdb") || file.size === 0 || file.size > 256 * 1024 * 1024) {
      setError("Choose a Diet Pro .mdb file between 1 byte and 256 MB.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/import-access", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.text()).trim() || "Database conversion failed.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      setResult({
        url: URL.createObjectURL(blob),
        profiles: Number(response.headers.get("X-DietPro-Imported-Profiles")),
        entries: Number(response.headers.get("X-DietPro-Imported-Entries")),
        recipes: Number(response.headers.get("X-DietPro-Imported-Recipes")),
      });
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      request.current = null;
      setBusy(false);
    }
  }

  return <section className="content content-narrow">
    <h1>Import legacy database</h1>
    <p>Choose a Diet Pro 2005 Access database, usually named <code>dp20.mdb</code>. Conversion runs on this PC and creates a separate Diet Pro database.</p>
    <form className="stack panel" onSubmit={event => {
      event.preventDefault();
      if (source && !busy) void convert(source);
    }}>
      <label>Diet Pro database <input type="file" accept=".mdb" required disabled={busy} onChange={event => {
        setSource(event.target.files?.[0] ?? null);
        setResult(null);
        setError("");
      }} /></label>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !source}>{busy ? "Converting…" : "Convert database"}</button>
        {busy && <button type="button" className="btn" onClick={() => request.current?.abort()}>Cancel conversion</button>}
      </div>
      {busy && <p role="status">Reading and converting the original records. Large databases can take a few minutes.</p>}
      {error && <ErrorBox error={error} />}
    </form>
    {result && <section className="panel">
      <h2>Conversion complete</h2>
      <p>{result.profiles.toLocaleString()} profiles · {result.entries.toLocaleString()} meal entries · {result.recipes.toLocaleString()} recipes</p>
      <p><a className="btn btn-primary" href={result.url} download="DietPro-imported.db">Save converted database</a></p>
      <ol>
        <li>Move <code>DietPro-imported.db</code> next to <code>DietPro.exe</code>.</li>
        <li>Exit through File → Exit Diet Pro, then double-click <code>DietPro.exe</code> again.</li>
        <li>Choose <strong>DietPro-imported</strong> from the Database selector at the bottom of the navigation pane.</li>
      </ol>
      <p>To open the imported data by default, copy the executable and converted file into a separate folder and rename the converted file <code>DietPro.db</code> in that folder.</p>
    </section>}
    <p className="muted">Imports supported catalog, profile, diary, exercise, weight, menu, shopping and pantry records. Photographs that the old database references as separate image files stay in the original folders.</p>
  </section>;
}
