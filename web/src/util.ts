import { useEffect, useRef, useState } from "react";

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": " 1/2", "⅓": " 1/3", "⅔": " 2/3", "¼": " 1/4", "¾": " 3/4", "⅛": " 1/8", "⅜": " 3/8", "⅝": " 5/8", "⅞": " 7/8",
};

/** Parses recipe quantities like "1 1/2", "3/4", "2.5", "1½" or "2-3" (uses the first number). */
export function parseQuantity(text: string): number | null {
  let s = text.trim();
  if (!s) return null;
  for (const [u, r] of Object.entries(UNICODE_FRACTIONS)) s = s.split(u).join(r);
  s = s.split(/\s*(?:-|–|to)\s*/)[0].trim();
  let total = 0;
  let matched = false;
  for (const part of s.split(/\s+/)) {
    const frac = part.match(/^(\d+)\/(\d+)$/);
    if (frac) {
      if (Number(frac[2]) === 0) return null;
      total += Number(frac[1]) / Number(frac[2]);
      matched = true;
    } else if (/^\d*\.?\d+$/.test(part)) {
      total += Number(part);
      matched = true;
    } else {
      break;
    }
  }
  return matched ? total : null;
}

const NICE_FRACTIONS: [number, string][] = [
  [0, ""], [1 / 8, "1/8"], [1 / 4, "1/4"], [1 / 3, "1/3"], [3 / 8, "3/8"], [1 / 2, "1/2"],
  [5 / 8, "5/8"], [2 / 3, "2/3"], [3 / 4, "3/4"], [7 / 8, "7/8"], [1, ""],
];

/** Formats a number as a kitchen-friendly mixed fraction ("1 1/2"). */
export function formatQuantity(n: number): string {
  if (!isFinite(n) || n <= 0) return "";
  let whole = Math.floor(n);
  const rest = n - whole;
  let best = NICE_FRACTIONS[0];
  for (const f of NICE_FRACTIONS) if (Math.abs(f[0] - rest) < Math.abs(best[0] - rest)) best = f;
  if (Math.abs(best[0] - rest) > 0.04) return String(Math.round(n * 100) / 100);
  if (best[0] === 1) whole += 1;
  if (whole === 0) return best[1] || "0";
  return best[1] ? `${whole} ${best[1]}` : String(whole);
}

/** Scales the leading quantity in a recipe line's quantity text. */
export function scaleQuantity(text: string, factor: number): string {
  if (factor === 1) return text;
  const q = parseQuantity(text);
  if (q === null) return text;
  return formatQuantity(q * factor);
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !isFinite(n)) return "–";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Rounds nutrient amounts sensibly for display based on magnitude. */
export function fmtNutrient(n: number | undefined): string {
  if (n === undefined) return "–";
  const a = Math.abs(n);
  if (a >= 100) return fmt(n, 0);
  if (a >= 10) return fmt(n, 1);
  if (a >= 1) return fmt(n, 1);
  if (a === 0) return "0";
  return fmt(n, 2);
}

export function fmtMinutes(m: number): string {
  if (!m) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
}

export const kgToLb = (kg: number) => kg * 2.20462;
export const lbToKg = (lb: number) => lb / 2.20462;

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Runs an async loader whenever deps change, ignoring stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const run = () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => n === seq.current && setState({ data, loading: false }),
      (e: Error) => n === seq.current && setState({ error: e.message, loading: false }),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  return { ...state, reload: run, setData: (data: T) => setState({ data, loading: false }) };
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : (JSON.parse(s) as T);
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      /* storage unavailable */
    }
  };
  return [v, set];
}
