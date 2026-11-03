import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Icon, Spinner } from "./components/ui";
import { MetaContext } from "./meta";
import { useAsync, useLocalStorage } from "./util";
import RecipesPage from "./pages/Recipes";
import RecipeView from "./pages/RecipeView";
import RecipeEdit from "./pages/RecipeEdit";
import FoodsPage from "./pages/Foods";
import FoodView from "./pages/FoodView";
import FoodEdit from "./pages/FoodEdit";
import DiaryPage from "./pages/Diary";
import ProfilesPage from "./pages/Profiles";
import ReferencePage from "./pages/Reference";

const NAV = [
  { to: "/recipes", label: "Recipes", icon: "book" },
  { to: "/foods", label: "Ingredients", icon: "leaf" },
  { to: "/diary", label: "Diary", icon: "calendar" },
  { to: "/profiles", label: "Profiles", icon: "user" },
  { to: "/reference", label: "Reference", icon: "info" },
];

type Theme = "system" | "light" | "dark";

export default function App() {
  const meta = useAsync(() => api.meta(), []);
  const [theme, setTheme] = useLocalStorage<Theme>("dp.theme", "system");
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => setNavOpen(false), [loc.pathname]);

  if (meta.loading && !meta.data) return <Spinner />;
  if (meta.error || !meta.data) return <ErrorBox error={meta.error ?? "Could not load app data"} onRetry={meta.reload} />;

  return (
    <MetaContext.Provider value={meta.data}>
      <div className="shell">
        <header className="topbar">
          <button className="icon-btn nav-toggle" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>
            <Icon name="menu" />
          </button>
          <span className="brand">
            <span className="brand-mark" aria-hidden />
            Diet Pro
          </span>
        </header>
        <nav className={"sidebar" + (navOpen ? " open" : "")} aria-label="Main">
          <div className="brand brand-side">
            <span className="brand-mark" aria-hidden />
            Diet Pro
          </div>
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to}>
                  <Icon name={n.icon} />
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="sidebar-foot">
            <label className="field-label" htmlFor="theme">
              Theme
            </label>
            <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <p className="muted small">
              {meta.data.counts.recipes.toLocaleString()} recipes · {meta.data.counts.foods.toLocaleString()} ingredients
            </p>
          </div>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<Navigate to="/recipes" replace />} />
            <Route path="/recipes" element={<RecipesPage />} />
            <Route path="/recipes/new" element={<RecipeEdit />} />
            <Route path="/recipes/:id" element={<RecipeView />} />
            <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
            <Route path="/foods" element={<FoodsPage />} />
            <Route path="/foods/new" element={<FoodEdit />} />
            <Route path="/foods/:id" element={<FoodView />} />
            <Route path="/foods/:id/edit" element={<FoodEdit />} />
            <Route path="/diary" element={<DiaryPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/reference" element={<ReferencePage />} />
            <Route path="*" element={<div className="state">Page not found.</div>} />
          </Routes>
        </main>
      </div>
    </MetaContext.Provider>
  );
}
