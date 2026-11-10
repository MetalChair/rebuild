import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, dbKey, initDatabases, switchDatabase } from "./api";
import { ErrorBox, Spinner } from "./components/ui";
import { MetaContext } from "./meta";
import { initPreferences, useAsync, useLocalStorage } from "./util";
import RecipesPage from "./pages/Recipes";
import RecipeView from "./pages/RecipeView";
import RecipeEdit from "./pages/RecipeEdit";
import FoodsPage from "./pages/Foods";
import FoodView from "./pages/FoodView";
import FoodEdit from "./pages/FoodEdit";
import DiaryPage from "./pages/Diary";
import ProfilesPage from "./pages/Profiles";
import PhotographsPage from "./pages/Photographs";
import MenusPage from "./pages/Menus";
import SavedLinksPage from "./pages/SavedLinks";
import ReferencePage from "./pages/Reference";
import { Activities, Home, Help, Shopping, Internet, Inventory, Stores } from "./pages/Workspace";
import "./workspace.css";

const SECTIONS = {
  Profile: [
    ["Home", "/", "⌂"], ["Profiles", "/profiles", "▣"], ["Calendar", "/diary?view=calendar", "▦"],
    ["Meal Plan", "/diary?view=meals", "▤"], ["Exercise", "/diary?view=exercise", "↗"],
    ["Goals", "/profiles?view=goals", "✓"], ["Diary", "/diary", "▧"], ["Photographs", "/photographs", "▣"], ["Reports", "/diary?view=reports", "▥"],
  ],
  Cooking: [
    ["Cookbooks", "/recipes", "▣"], ["Menus", "/menus", "▤"], ["Ingredients", "/foods", "▣"],
    ["Glossary", "/reference?tab=glossary", "▣"], ["Cooking Techniques", "/reference", "▣"],
    ["Cooking Favorites", "/cooking/favorites", "☆"], ["Cooking Searches", "/cooking/searches", "⌕"],
  ],
  Shopping: [["Grocery Lists", "/shopping", "▣"], ["Inventory", "/inventory", "▤"], ["Stores", "/stores", "▣"]],
  Exercise: [["Activities", "/activities", "▣"], ["Exercise Favorites", "/exercise/favorites", "☆"], ["Exercise Searches", "/exercise/searches", "⌕"]],
  Internet: [["Internet Reference", "/internet", "▣"]],
} as const;

type Section = keyof typeof SECTIONS;

function sectionFor(path: string): Section {
  if (/^\/(recipes|foods|reference|menus|cooking)/.test(path)) return "Cooking";
  if (["/shopping", "/inventory", "/stores"].includes(path)) return "Shopping";
  if (path === "/activities" || path.startsWith("/exercise/")) return "Exercise";
  if (path === "/internet") return "Internet";
  return "Profile";
}

type Theme = "system" | "light" | "dark";

export default function App() {
  // Settle which database this tab uses before loading anything from it.
  const boot = useAsync(async () => {
    const dbs = await initDatabases();
    const [meta] = await Promise.all([api.meta(), initPreferences()]);
    return { dbs, meta };
  }, []);
  const [theme, setTheme] = useLocalStorage<Theme>("dp.theme", "light");

  const loc = useLocation();
  const workspaceBody = useRef<HTMLDivElement>(null);
  useEffect(() => { workspaceBody.current?.scrollTo(0, 0); }, [loc.pathname]);
  const navigate = useNavigate();
  const section = sectionFor(loc.pathname);
  const profileRefresh = loc.pathname === "/profiles" ? loc.key : section;
  const profileList = useAsync(() => boot.data && section === "Profile" ? api.profiles() : Promise.resolve([]), [boot.data, profileRefresh]);
  const [activeProfile, setActiveProfile] = useLocalStorage<number | null>(dbKey("dp.profile"), null);
  const profiles = profileList.data ?? [];
  const selectedProfile = profiles.find(profile => profile.id === activeProfile) ?? profiles[0];
  const query = new URLSearchParams(loc.search);
  const context = query.get("view") ? "?view=" + query.get("view") : query.get("tab") ? "?tab=" + query.get("tab") : "";
  const fullPath = loc.pathname + context;
  const nodes = SECTIONS[section];
  const active = nodes.find(([_, path]) => path === fullPath)
    ?? [...nodes].reverse().find(([_, path]) => !path.includes("?") && (path === loc.pathname || (path !== "/" && loc.pathname.startsWith(path + "/"))));
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState("");
  async function exit() {
    try {
      const response = await fetch("/quit", { method: "POST" });
      if (!response.ok) throw new Error("Unable to close Diet Pro.");
      setExiting(true);
    } catch (error) {
      setExitError(String(error));
    }
  }

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const dbs = boot.data?.dbs;
  const multi = !!dbs && dbs.databases.length > 1;
  useEffect(() => {
    document.title = multi ? `${dbs!.current} · Diet Pro` : "Diet Pro";
  }, [multi, dbs]);

  useEffect(() => {
    if (exiting) return;
    const heartbeat = () => { void fetch("/heartbeat", { cache: "no-store" }).catch(() => undefined); };
    const timer = window.setInterval(heartbeat, 60_000);
    window.addEventListener("focus", heartbeat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", heartbeat);
    };
  }, [exiting]);

  useEffect(() => {
    const menu = document.querySelector(".desktop-menubar");
    if (!menu) return;
    const closeMenus = () => menu.querySelectorAll("details[open]").forEach(item => item.removeAttribute("open"));
    function outside(event: MouseEvent) {
      if (event.target instanceof Element && (!menu!.contains(event.target) || event.target.closest("a, button"))) closeMenus();
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenus();
      if (event.key === "F1") { event.preventDefault(); navigate("/help"); }
    }
    document.addEventListener("click", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [navigate, boot.data]);

  if (exiting) return <div className="state">Diet Pro is closed. You can close this window.</div>;
  if (boot.loading && !boot.data) return <Spinner />;
  if (boot.error || !boot.data) return <ErrorBox error={boot.error ?? "Could not load app data"} onRetry={boot.reload} />;
  const meta = boot.data.meta;

  return (
    <MetaContext.Provider value={meta}>
      <div className="diet-workspace">
        <div className="desktop-menubar" aria-label="Application menu">
          <details><summary>File</summary><div><NavLink to="/profiles">Manage profiles</NavLink><button onClick={() => window.print()}>Print</button><a href={"/api/backup?db=" + encodeURIComponent(dbs!.current)} download>Back up database</a><button onClick={exit}>Exit Diet Pro</button></div></details>
          <details><summary>View</summary><div>{Object.entries(SECTIONS).map(([name, entries]) => <NavLink key={name} to={entries[0][1]}>{name}</NavLink>)}</div></details>
          <details><summary>Help</summary><div><NavLink to="/help">Contents and Index</NavLink></div></details>
        </div>
        <div className="desktop-tools">
          <button title="Back" aria-label="Back" onClick={() => navigate(-1)}>←</button>
          <button title="Forward" aria-label="Forward" onClick={() => navigate(1)}>→</button>
          <NavLink to="/" title="Home" aria-label="Home">⌂</NavLink>
          <NavLink to="/profiles" title="Profiles" aria-label="Profiles">♙</NavLink>
          <NavLink to="/diary?view=calendar" title="Calendar" aria-label="Calendar">▦</NavLink>
          <NavLink to="/diary?view=meals" title="Meal plan" aria-label="Meal plan">▤</NavLink>
          <NavLink to="/recipes" title="Recipes" aria-label="Recipes">▣</NavLink>
          <NavLink to="/shopping" title="Grocery lists" aria-label="Grocery lists">☷</NavLink>
          <NavLink to="/help" title="Help" aria-label="Help">?</NavLink>
        </div>
        {exitError && <ErrorBox error={exitError} />}
        <div className="workspace-title"><span className="tomato" aria-hidden>●</span> Diet Workspace</div>
        <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <div className="tree-pane">
            <ul>
              {(section === "Profile" && selectedProfile ? nodes.slice(0, 2) : nodes).map(([label, to, icon]) => (
                <li key={to}>
                  <Link to={to} className={active?.[1] === to ? "selected" : ""} aria-current={active?.[1] === to ? "page" : undefined}>
                    <span aria-hidden className="tree-glyph">{icon}</span>{label}
                  </Link>
                  {label === "Profiles" && selectedProfile && (
                    <ul className="profile-tree">
                      {profiles.map(profile => (
                        <li key={profile.id}>
                          <Link className="profile-node" to={"/profiles?profile=" + profile.id} onClick={() => setActiveProfile(profile.id)}>
                            <span aria-hidden className="tree-glyph">♙</span>{profile.name}
                          </Link>
                          {profile.id === selectedProfile.id && <ul className="profile-branch">
                            {nodes.slice(2).map(([child, path, glyph]) => <li key={path}>
                              <Link to={path} className={active?.[1] === path ? "selected" : ""} aria-current={active?.[1] === path ? "page" : undefined}>
                                <span aria-hidden className="tree-glyph">{glyph}</span>{child}
                              </Link>
                            </li>)}
                          </ul>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="workspace-tabs" aria-label="Sections">
            {Object.entries(SECTIONS).map(([name, entries]) =>
              <NavLink key={name} to={entries[0][1]} className={section === name ? "current" : ""}>{name}</NavLink>
            )}
          </div>
          <div className="sidebar-foot">
            {multi && (
              <>
                <label className="field-label" htmlFor="database">
                  Database
                </label>
                <select id="database" value={dbs!.current} onChange={(e) => switchDatabase(e.target.value)}>
                  {dbs!.databases.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label className="field-label" htmlFor="theme">
              Theme
            </label>
            <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <p className="muted small">
              {meta.counts.recipes.toLocaleString()} recipes · {meta.counts.foods.toLocaleString()} ingredients
            </p>
          </div>
        </nav>
        <main className="main">
          <div className="workspace-body" ref={workspaceBody}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/activities" element={<Activities />} />
            <Route path="/cooking/favorites" element={<SavedLinksPage key="cf" section="cooking" kind="favorite" />} />
            <Route path="/cooking/searches" element={<SavedLinksPage key="cs" section="cooking" kind="search" />} />
            <Route path="/exercise/favorites" element={<SavedLinksPage key="ef" section="exercise" kind="favorite" />} />
            <Route path="/exercise/searches" element={<SavedLinksPage key="es" section="exercise" kind="search" />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/stores" element={<Stores />} />
            <Route path="/menus" element={<MenusPage />} />
            <Route path="/internet" element={<Internet />} />
            <Route path="/help" element={<Help />} />
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
            <Route path="/photographs" element={<PhotographsPage />} />
            <Route path="/reference" element={<ReferencePage />} />
            <Route path="*" element={<div className="state">Page not found.</div>} />
          </Routes>
          </div>
          <div className="workspace-status"><span>{active?.[0] ?? "Help"}</span><span>{meta.counts.recipes.toLocaleString()} recipes · {meta.counts.foods.toLocaleString()} ingredients</span></div>
        </main>
        </div>
      </div>
    </MetaContext.Provider>
  );
}
