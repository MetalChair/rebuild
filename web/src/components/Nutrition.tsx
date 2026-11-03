import { useState } from "react";
import type { Nutr } from "../api";
import { useMeta } from "../meta";
import { fmt, fmtNutrient } from "../util";

const pct = (v: number | undefined, dv: number | null) => (v === undefined || !dv ? null : Math.round((v / dv) * 100));

/** FDA-style Nutrition Facts panel. */
export function NutritionFacts({ values, serving, servings }: { values: Nutr; serving?: string; servings?: string }) {
  const meta = useMeta();
  const def = Object.fromEntries(meta.nutrients.map((n) => [n.key, n]));
  const row = (key: string, label: string, indent = 0, bold = false) => {
    const v = values[key];
    const p = pct(v, def[key]?.daily_value ?? null);
    return (
      <div className={"nf-row" + (indent ? " nf-indent" : "")} key={key}>
        <span>
          {bold ? <b>{label}</b> : label} {v === undefined ? "–" : fmtNutrient(v) + def[key].unit}
        </span>
        <b>{p === null ? "" : p + "%"}</b>
      </div>
    );
  };
  const micro = ["vitamind", "calcium", "iron", "potassium", "vitamina", "vitaminc"].filter((k) => values[k] !== undefined);
  return (
    <section className="nf" aria-label="Nutrition facts">
      <h3 className="nf-title">Nutrition Facts</h3>
      {servings && <div className="nf-small">{servings}</div>}
      {serving && (
        <div className="nf-serving">
          <b>Serving size</b>
          <b>{serving}</b>
        </div>
      )}
      <div className="nf-bar-thick" />
      <div className="nf-small">
        <b>Amount per serving</b>
      </div>
      <div className="nf-cal">
        <span>Calories</span>
        <span>{values.calories === undefined ? "–" : fmt(values.calories)}</span>
      </div>
      <div className="nf-bar-mid" />
      <div className="nf-row nf-dvhead">
        <span />
        <b>% Daily Value*</b>
      </div>
      {row("totalfat", "Total Fat", 0, true)}
      {row("saturatedfat", "Saturated Fat", 1)}
      {values.transfattyacids !== undefined && row("transfattyacids", "Trans Fat", 1)}
      {row("cholesterol", "Cholesterol", 0, true)}
      {row("sodium", "Sodium", 0, true)}
      {row("totalcarbohydrate", "Total Carbohydrate", 0, true)}
      {row("fiber", "Dietary Fiber", 1)}
      {row("sugar", "Total Sugars", 1)}
      {row("protein", "Protein", 0, true)}
      <div className="nf-bar-thick" />
      {micro.map((k) => row(k, def[k].name))}
      <div className="nf-foot">* Percent Daily Values are based on a 2,000 calorie diet.</div>
    </section>
  );
}

/** Calories split by macronutrient (fat 9, carbs 4, protein 4, alcohol 7 kcal/g). */
export function MacroSplit({ values }: { values: Nutr }) {
  const parts = [
    { key: "carbs", label: "Carbs", kcal: (values.totalcarbohydrate ?? 0) * 4, grams: values.totalcarbohydrate },
    { key: "fat", label: "Fat", kcal: (values.totalfat ?? 0) * 9, grams: values.totalfat },
    { key: "protein", label: "Protein", kcal: (values.protein ?? 0) * 4, grams: values.protein },
  ];
  const alcohol = (values.alcohol ?? 0) * 7;
  if (alcohol > 0) parts.push({ key: "alcohol", label: "Alcohol", kcal: alcohol, grams: values.alcohol });
  const total = parts.reduce((s, p) => s + p.kcal, 0);
  if (total <= 0) return null;
  return (
    <div className="macro">
      <div className="macro-bar" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.kcal / total) * 100)}%`).join(", ")}>
        {parts.map((p) =>
          p.kcal / total >= 0.005 ? <span key={p.key} className={"macro-seg macro-" + p.key} style={{ flexGrow: p.kcal }} title={`${p.label}: ${Math.round((p.kcal / total) * 100)}%`} /> : null,
        )}
      </div>
      <ul className="macro-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={"swatch macro-" + p.key} aria-hidden />
            {p.label} <b>{Math.round((p.kcal / total) * 100)}%</b> <span className="muted">{fmtNutrient(p.grams)} g</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  energy: "Energy",
  macro: "Macronutrients",
  vitamin: "Vitamins",
  mineral: "Minerals",
  other: "Other",
};

/** Full nutrient listing grouped by category, with %DV bars. */
export function NutrientTable({ values }: { values: Nutr }) {
  const meta = useMeta();
  const [showEmpty, setShowEmpty] = useState(false);
  const cats = Object.keys(CATEGORY_LABELS);
  return (
    <div className="ntable">
      {cats.map((c) => {
        const rows = meta.nutrients.filter((n) => n.category === c && (showEmpty || values[n.key] !== undefined));
        if (!rows.length) return null;
        return (
          <table key={c}>
            <caption>{CATEGORY_LABELS[c]}</caption>
            <tbody>
              {rows.map((n) => {
                const v = values[n.key];
                const p = pct(v, n.daily_value);
                return (
                  <tr key={n.key}>
                    <th scope="row">{n.name}</th>
                    <td className="num">
                      {v === undefined ? <span className="muted">no data</span> : `${fmtNutrient(v)} ${n.unit}`}
                    </td>
                    <td className="dv">
                      {p !== null && (
                        <>
                          <span className="dv-track" aria-hidden>
                            <span className="dv-fill" style={{ width: Math.min(p, 100) + "%" }} />
                          </span>
                          <span className="dv-num">{p}%</span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}
      <label className="check">
        <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Show nutrients with no data
      </label>
    </div>
  );
}
