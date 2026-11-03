import { ReactNode, useEffect, useRef } from "react";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <strong>Something went wrong.</strong> {error}
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state state-empty">{children}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " modal-wide" : "")} role="dialog" aria-modal aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={"field " + (className ?? "")}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** A numeric input that keeps the user's text while editing and reports numbers or null. */
export function NumberInput({
  value, onChange, step = "any", min, placeholder, className, ariaLabel,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  step?: string;
  min?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      step={step}
      min={min}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value === null || value === undefined || Number.isNaN(value) ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

const ICONS: Record<string, string> = {
  book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17zM4 19.5A2.5 2.5 0 0 1 6.5 17H20",
  leaf: "M5 21c0-9 6-16 16-16 0 10-7 16-16 16zM5 21l8-8",
  calendar: "M3 6h18v15H3zM3 10h18M8 3v4M16 3v4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 3",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 7.5M22 21c0-3-2-5-5-5.5",
  star: "M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.2L12 17.2 6.5 20.1l1-6.2L3 9.5l6.3-.9z",
  photo: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  menu: "M4 6h16M4 12h16M4 18h16",
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}
