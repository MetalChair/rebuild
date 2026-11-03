import { useEffect, useRef, useState } from "react";
import { api, type FoodSummary } from "../api";
import { fmt, useDebounced } from "../util";

/** Search-as-you-type ingredient picker with keyboard navigation. */
export function FoodPicker({ onPick, initial = "", placeholder = "Search ingredients…", autoFocus }: {
  onPick: (f: FoodSummary) => void;
  initial?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FoodSummary[]>([]);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 200);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || dq.trim().length < 2) {
      setItems([]);
      return;
    }
    let live = true;
    api.foods({ q: dq, limit: 12 }).then((p) => live && (setItems(p.items), setActive(0)));
    return () => {
      live = false;
    };
  }, [dq, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (f: FoodSummary) => {
    onPick(f);
    setQ(f.name);
    setOpen(false);
  };

  return (
    <div className="picker" ref={box}>
      <input
        type="search"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && items[active]) (e.preventDefault(), pick(items[active]));
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <ul className="picker-list" role="listbox">
          {items.map((f, i) => (
            <li
              key={f.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => (e.preventDefault(), pick(f))}
            >
              <span>{f.name}</span>
              <span className="muted">{f.calories === null ? "" : fmt(f.calories) + " kcal/100g"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
