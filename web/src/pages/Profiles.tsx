import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Profile, dbKey } from "../api";
import { ErrorBox, Field, Icon, NumberInput, Spinner } from "../components/ui";
import { fmt, isoDate, kgToLb, lbToKg, useAsync, useLocalStorage } from "../util";

const ACTIVITY_LEVELS = [
  { v: 1.2, label: "Sedentary (little exercise)" },
  { v: 1.375, label: "Lightly active (1–3 days/week)" },
  { v: 1.55, label: "Moderately active (3–5 days/week)" },
  { v: 1.725, label: "Very active (6–7 days/week)" },
];

const blank = (): Profile => ({
  id: 0,
  name: "",
  gender: "Female",
  age: null,
  height_cm: null,
  start_date: isoDate(new Date()),
  end_date: "",
  start_weight_kg: null,
  goal_weight_kg: null,
  weekly_change_kg: 0,
  activity_factor: 1.2,
  budget_mode: "automatic",
  calorie_budget: null,
  comments: "",
});

export default function ProfilesPage() {
  const profiles = useAsync(() => api.profiles(), []);
  const [activeId, setActiveId] = useLocalStorage<number | null>(dbKey("dp.profile"), null);
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get("profile")) || activeId;
  const select = (id: number | null) => {
    setActiveId(id);
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (id) next.set("profile", String(id));
      else next.delete("profile");
      return next;
    }, { replace: true });
  };
  const [creating, setCreating] = useState(false);

  if (profiles.loading && !profiles.data) return <Spinner />;
  if (profiles.error) return <ErrorBox error={profiles.error} onRetry={profiles.reload} />;
  const list = profiles.data ?? [];
  const selected = creating ? blank() : list.find((p) => p.id === selectedId) ?? list[0] ?? blank();
  const isNew = selected.id === 0;

  return (
    <div className="content content-narrow">
      <div className="page-head">
        <div>
          <h1>{params.get("view") === "goals" ? "Goals" : "Profiles"}</h1>
          <p className="muted">Each profile keeps its own diary, weight log and calorie budget.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> New profile
        </button>
      </div>
      {list.length > 0 && (
        <div className="chips">
          {list.map((p) => (
            <button key={p.id} className={"chip" + (!creating && p.id === selected.id ? " chip-on" : "")} onClick={() => (select(p.id), setCreating(false))}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <ProfileForm
        key={isNew ? "new" : selected.id}
        profile={selected}
        onSaved={(p) => {
          setCreating(false);
          select(p.id);
          profiles.reload();
        }}
        onDeleted={() => {
          select(null);
          profiles.reload();
        }}
      />
    </div>
  );
}

function ProfileForm({ profile, onSaved, onDeleted }: { profile: Profile; onSaved: (p: Profile) => void; onDeleted: () => void }) {
  const [units, setUnits] = useLocalStorage<"lb" | "kg">("dp.units", "lb");
  const [p, setP] = useState<Profile>(profile);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const imperial = units === "lb";
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => (setP({ ...p, [k]: v }), setSaved(false));
  const wIn = (kg: number | null) => (kg === null ? null : Math.round((imperial ? kgToLb(kg) : kg) * 10) / 10);
  const wOut = (v: number | null) => (v === null ? null : imperial ? lbToKg(v) : v);
  const isNew = p.id === 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const res = isNew ? await api.createProfile(p) : await api.updateProfile(p.id, p);
      setP(res);
      setSaved(true);
      onSaved(res);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete profile "${p.name}" and its entire diary? This cannot be undone.`)) return;
    try {
      await api.deleteProfile(p.id);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      {error && <ErrorBox error={error} />}
      <section className="panel form-grid">
        <div className="span-all panel-head">
          <h2>{isNew ? "New profile" : p.name}</h2>
          <div className="seg seg-sm">
            <button type="button" className={imperial ? "on" : ""} onClick={() => setUnits("lb")}>
              lb / in
            </button>
            <button type="button" className={!imperial ? "on" : ""} onClick={() => setUnits("kg")}>
              kg / cm
            </button>
          </div>
        </div>
        <Field label="Name">
          <input value={p.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Sex" hint="Used for the metabolic rate estimate">
          <select value={p.gender} onChange={(e) => set("gender", e.target.value)}>
            <option>Female</option>
            <option>Male</option>
          </select>
        </Field>
        <Field label="Age">
          <NumberInput value={p.age} min={1} step="1" onChange={(v) => set("age", v)} />
        </Field>
        <Field label={imperial ? "Height (in)" : "Height (cm)"}>
          <NumberInput
            value={p.height_cm === null ? null : Math.round((imperial ? p.height_cm / 2.54 : p.height_cm) * 10) / 10}
            min={0}
            onChange={(v) => set("height_cm", v === null ? null : imperial ? v * 2.54 : v)}
          />
        </Field>
        <Field label={`Starting weight (${units})`}>
          <NumberInput value={wIn(p.start_weight_kg)} min={0} onChange={(v) => set("start_weight_kg", wOut(v))} />
        </Field>
        <Field label={`Goal weight (${units})`}>
          <NumberInput value={wIn(p.goal_weight_kg)} min={0} onChange={(v) => set("goal_weight_kg", wOut(v))} />
        </Field>
        <Field label="Start date">
          <input type="date" value={p.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </Field>
        <Field label="Target date">
          <input type="date" value={p.end_date} onChange={(e) => set("end_date", e.target.value)} />
        </Field>
        <Field label="Comments" className="span-all">
          <textarea rows={2} value={p.comments} onChange={(e) => set("comments", e.target.value)} />
        </Field>
      </section>

      <section className="panel form-grid">
        <h2 className="span-all">Calorie budget</h2>
        <fieldset className="span-all">
          <label className="check">
            <input type="radio" checked={p.budget_mode === "automatic"} onChange={() => set("budget_mode", "automatic")} /> Calculate from my stats and plan
          </label>
          <label className="check">
            <input type="radio" checked={p.budget_mode === "manual"} onChange={() => set("budget_mode", "manual")} /> Set it myself
          </label>
        </fieldset>
        {p.budget_mode === "automatic" ? (
          <>
            <Field label="Activity level">
              <select value={p.activity_factor} onChange={(e) => set("activity_factor", Number(e.target.value))}>
                {ACTIVITY_LEVELS.map((a) => (
                  <option key={a.v} value={a.v}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Planned change (${units}/week)`} hint="Negative to lose, positive to gain">
              <NumberInput
                value={Math.round((imperial ? kgToLb(p.weekly_change_kg) : p.weekly_change_kg) * 100) / 100}
                step="0.1"
                onChange={(v) => set("weekly_change_kg", (v ?? 0) / (imperial ? 2.20462 : 1))}
              />
            </Field>
          </>
        ) : (
          <Field label="Daily budget (kcal)">
            <NumberInput value={p.calorie_budget} min={0} step="1" onChange={(v) => set("calorie_budget", v)} />
          </Field>
        )}
        {!isNew && (
          <dl className="facts span-all">
            <div>
              <dt>Current weight</dt>
              <dd>{p.latest_weight_kg ? `${fmt(wIn(p.latest_weight_kg), 1)} ${units}` : "–"}</dd>
            </div>
            <div>
              <dt>Resting (BMR)</dt>
              <dd>{p.bmr ? `${fmt(p.bmr)} kcal` : "–"}</dd>
            </div>
            <div>
              <dt>Maintenance</dt>
              <dd>{p.maintenance ? `${fmt(p.maintenance)} kcal` : "–"}</dd>
            </div>
            <div>
              <dt>Daily budget</dt>
              <dd>{p.budget ? `${fmt(p.budget)} kcal` : "–"}</dd>
            </div>
          </dl>
        )}
        <p className="muted small span-all">
          Estimates use the Mifflin–St Jeor equation and about 7,700 kcal per kg of body weight. Saved values update after you save.
        </p>
      </section>

      <div className="actions">
        <button className="btn btn-primary">{isNew ? "Create profile" : "Save changes"}</button>
        {saved && <span className="muted">Saved.</span>}
        {!isNew && (
          <>
            <Link className="btn" to="/diary">
              Open diary
            </Link>
            <button type="button" className="btn btn-ghost danger" onClick={remove}>
              <Icon name="trash" /> Delete profile
            </button>
          </>
        )}
      </div>
    </form>
  );
}
