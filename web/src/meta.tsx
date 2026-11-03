import { createContext, useContext } from "react";
import type { Meta, NutrientDef } from "./api";

export const MetaContext = createContext<Meta | null>(null);

export function useMeta(): Meta {
  const m = useContext(MetaContext);
  if (!m) throw new Error("meta not loaded");
  return m;
}

export function useNutrientMap(): Record<string, NutrientDef> {
  const m = useMeta();
  return Object.fromEntries(m.nutrients.map((n) => [n.key, n]));
}
