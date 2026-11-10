import { useState } from "react";
import type { SummaryDay } from "../api";
import { fmt } from "../util";

const W = 640;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 26, left: 44 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

const shortDate = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${m}/${day}`;
};

function Axis({ ticks, y, format }: { ticks: number[]; y: (v: number) => number; format: (v: number) => string }) {
  return (
    <g className="chart-axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
          <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ days, x }: { days: SummaryDay[]; x: (i: number) => number }) {
  const every = Math.ceil(days.length / 7);
  return (
    <g className="chart-axis">
      {days.map((d, i) =>
        i % every === 0 || i === days.length - 1 ? (
          <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle">
            {shortDate(d.date)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  // Positioned in percentage space so it tracks the responsive SVG.
  const left = (x / W) * 100;
  return (
    <div className="chart-tip" style={{ left: `${left}%`, top: `${(y / H) * 100}%`, transform: `translate(${left > 70 ? "-100%" : left < 30 ? "0" : "-50%"}, calc(-100% - 8px))` }} role="status">
      {children}
    </div>
  );
}

/** Daily calories eaten as bars with the budget as a reference line. */
export function CaloriesChart({ days, budget, onPick }: { days: SummaryDay[]; budget: number | null | undefined; onPick?: (date: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(budget ?? 0, ...days.map((d) => d.calories ?? 0)) * 1.05);
  const band = plotW / days.length;
  const barW = Math.min(28, Math.max(1, band * 0.78));
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const h = hover !== null ? days[hover] : null;
  return (
    <figure className="chart">
      <figcaption>Calories eaten</figcaption>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily calories eaten for the period" onMouseLeave={() => setHover(null)}>
          <Axis ticks={ticks} y={y} format={(v) => fmt(v)} />
          {days.map((d, i) => {
            const v = d.calories ?? 0;
            const top = y(v);
            const bh = Math.max(0, PAD.top + plotH - top);
            const r = Math.min(4, bh / 2, barW / 2);
            return (
              <g key={d.date}>
                {bh > 0 && (
                  <path
                    className={"chart-bar" + (hover === i ? " is-hover" : "")}
                    d={`M${x(i) - barW / 2},${PAD.top + plotH} V${top + r} q0,-${r} ${r},-${r} H${x(i) + barW / 2 - r} q${r},0 ${r},${r} V${PAD.top + plotH} Z`}
                  />
                )}
                <rect
                  className="chart-hit"
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => onPick?.(d.date)}
                />
              </g>
            );
          })}
          {budget ? (
            <g className="chart-ref">
              <line x1={PAD.left} x2={W - PAD.right} y1={y(budget)} y2={y(budget)} />
              <text x={PAD.left + 4} y={y(budget) - 5} textAnchor="start">
                Budget {fmt(budget)}
              </text>
            </g>
          ) : null}
          <XLabels days={days} x={x} />
        </svg>
        {h && hover !== null && (
          <Tooltip x={x(hover)} y={y(h.calories ?? 0)}>
            <b>{shortDate(h.date)}</b> {h.calories === null ? "nothing logged" : `${fmt(h.calories)} kcal`}
            {h.burned > 0 && <span className="muted"> · {fmt(h.burned)} burned</span>}
          </Tooltip>
        )}
      </div>
    </figure>
  );
}

/** Logged weight as a line; gaps where nothing was recorded. */
export function WeightChart({ days, unit, toUnit }: { days: SummaryDay[]; unit: string; toUnit: (kg: number) => number }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = days.map((d, i) => ({ i, d, v: d.weight_kg === null ? null : toUnit(d.weight_kg) }));
  const vals = pts.filter((p) => p.v !== null).map((p) => p.v as number);
  if (vals.length === 0) {
    return (
      <figure className="chart">
        <figcaption>Weight ({unit})</figcaption>
        <p className="muted small chart-empty">No weights logged in this period.</p>
      </figure>
    );
  }
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const padV = Math.max(1, (hi - lo) * 0.2);
  lo = Math.floor(lo - padV);
  hi = Math.ceil(hi + padV);
  const band = plotW / days.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const known = pts.filter((p) => p.v !== null);
  const path = known.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v as number)}`).join(" ");
  const h = hover !== null ? pts[hover] : null;
  return (
    <figure className="chart">
      <figcaption>Weight ({unit})</figcaption>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight in ${unit} for the period`} onMouseLeave={() => setHover(null)}>
          <Axis ticks={[lo, (lo + hi) / 2, hi]} y={y} format={(v) => fmt(v, 1)} />
          <path className="chart-line" d={path} />
          {known.map((p) => (
            <circle key={p.i} className={"chart-dot" + (hover === p.i ? " is-hover" : "")} cx={x(p.i)} cy={y(p.v as number)} r={hover === p.i ? 5 : 4} />
          ))}
          {hover !== null && <line className="chart-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />}
          {pts.map((p) => (
            <rect key={p.i} className="chart-hit" x={PAD.left + band * p.i} y={PAD.top} width={band} height={plotH} onMouseEnter={() => setHover(p.i)} />
          ))}
          <XLabels days={days} x={x} />
        </svg>
        {h && hover !== null && (
          <Tooltip x={x(hover)} y={h.v === null ? PAD.top + plotH / 2 : y(h.v)}>
            <b>{shortDate(h.d.date)}</b> {h.v === null ? "no weight logged" : `${fmt(h.v, 1)} ${unit}`}
          </Tooltip>
        )}
      </div>
    </figure>
  );
}
