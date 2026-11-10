// Package server exposes the JSON API and serves the embedded web UI.
package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

type srv struct{ db *sql.DB }

// New returns the application handler. static is the built frontend.
func New(db *sql.DB, static fs.FS) http.Handler {
	s := &srv{db: db}
	m := http.NewServeMux()

	m.HandleFunc("GET /api/meta", api(s.meta))
	m.HandleFunc("GET /api/saved", api(s.savedLinks))
	m.HandleFunc("POST /api/saved", api(s.addSavedLink))
	m.HandleFunc("DELETE /api/saved/{id}", api(s.deleteSavedLink))
	m.HandleFunc("GET /api/backup", s.backup)
	m.HandleFunc("GET /api/preferences", api(s.preferences))
	m.HandleFunc("PUT /api/preferences/{key}", api(s.setPreference))
	m.HandleFunc("GET /api/menus", api(s.menus))
	m.HandleFunc("POST /api/menus", api(s.addMenu))
	m.HandleFunc("PUT /api/menus/{id}", api(s.updateMenu))
	m.HandleFunc("DELETE /api/menus/{id}", api(s.deleteMenu))
	m.HandleFunc("GET /api/pantry", api(s.pantry))
	m.HandleFunc("PUT /api/pantry/{id}", api(s.updatePantry))
	m.HandleFunc("GET /api/stores", api(s.stores))
	m.HandleFunc("GET /api/grocery-lists", api(s.groceryLists))
	m.HandleFunc("POST /api/grocery-lists", api(s.addGroceryList))
	m.HandleFunc("PUT /api/grocery-lists/{id}", api(s.renameGroceryList))
	m.HandleFunc("DELETE /api/grocery-lists/{id}", api(s.deleteGroceryList))
	m.HandleFunc("GET /api/groceries", api(s.groceries))
	m.HandleFunc("POST /api/groceries", api(s.addGrocery))
	m.HandleFunc("PUT /api/groceries/{id}", api(s.checkGrocery))
	m.HandleFunc("DELETE /api/groceries/{id}", api(s.deleteGrocery))

	m.HandleFunc("GET /api/cookbooks", api(s.cookbooks))
	m.HandleFunc("GET /api/recipes", api(s.listRecipes))
	m.HandleFunc("POST /api/recipes", api(s.createRecipe))
	m.HandleFunc("GET /api/recipes/{id}", api(s.getRecipe))
	m.HandleFunc("PUT /api/recipes/{id}", api(s.updateRecipe))
	m.HandleFunc("DELETE /api/recipes/{id}", api(s.deleteRecipe))
	m.HandleFunc("PUT /api/recipes/{id}/photo", api(s.uploadRecipePhoto))
	m.HandleFunc("DELETE /api/recipes/{id}/photo", api(s.deleteRecipePhoto))

	m.HandleFunc("GET /api/food-groups", api(s.foodGroups))
	m.HandleFunc("GET /api/foods", api(s.listFoods))
	m.HandleFunc("POST /api/foods", api(s.createFood))
	m.HandleFunc("GET /api/foods/{id}", api(s.getFood))
	m.HandleFunc("PUT /api/foods/{id}", api(s.updateFood))
	m.HandleFunc("DELETE /api/foods/{id}", api(s.deleteFood))

	m.HandleFunc("GET /api/profiles", api(s.listProfiles))
	m.HandleFunc("POST /api/profiles", api(s.createProfile))
	m.HandleFunc("GET /api/profiles/{id}", api(s.getProfile))
	m.HandleFunc("GET /api/profiles/{id}/photographs", api(s.profilePhotos))
	m.HandleFunc("POST /api/profiles/{id}/photographs", api(s.addProfilePhoto))
	m.HandleFunc("GET /api/profiles/{id}/photographs/{photo}", s.getProfilePhoto)
	m.HandleFunc("DELETE /api/profiles/{id}/photographs/{photo}", api(s.deleteProfilePhoto))
	m.HandleFunc("PUT /api/profiles/{id}", api(s.updateProfile))
	m.HandleFunc("DELETE /api/profiles/{id}", api(s.deleteProfile))
	m.HandleFunc("GET /api/profiles/{id}/summary", api(s.profileSummary))
	m.HandleFunc("GET /api/profiles/{id}/diary/{date}", api(s.getDay))
	m.HandleFunc("POST /api/profiles/{id}/diary/{date}/entries", api(s.addEntry))
	m.HandleFunc("POST /api/profiles/{id}/diary/{date}/activities", api(s.addActivity))
	m.HandleFunc("PUT /api/profiles/{id}/diary/{date}/weight", api(s.setWeight))
	m.HandleFunc("PUT /api/profiles/{id}/diary/{date}/note", api(s.setNote))
	m.HandleFunc("PUT /api/entries/{id}", api(s.updateEntry))
	m.HandleFunc("DELETE /api/entries/{id}", api(s.deleteEntry))
	m.HandleFunc("DELETE /api/activity-log/{id}", api(s.deleteActivityLog))
	m.HandleFunc("GET /api/activities", api(s.listActivities))

	m.HandleFunc("GET /api/glossary", api(s.glossary))
	m.HandleFunc("GET /api/techniques", api(s.techniques))
	m.HandleFunc("GET /api/techniques/{id}", api(s.technique))

	m.HandleFunc("GET /media/{name}", s.media)
	m.HandleFunc("/api/", api(func(*http.Request) (any, error) { return nil, errStatus(http.StatusNotFound, "no such endpoint") }))
	m.Handle("/", spa(static))
	return recoverer(m)
}

// --- Errors and JSON plumbing ---------------------------------------------

type apiError struct {
	status int
	msg    string
}

func (e *apiError) Error() string { return e.msg }

func errStatus(status int, format string, a ...any) error {
	return &apiError{status, fmt.Sprintf(format, a...)}
}

func badRequest(format string, a ...any) error { return errStatus(http.StatusBadRequest, format, a...) }

// api adapts a handler that returns a value (encoded as JSON) or an error.
// A nil value with a nil error yields 204 No Content.
func api(fn func(*http.Request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := fn(r)
		if err != nil {
			status, msg := http.StatusInternalServerError, "internal error"
			var ae *apiError
			switch {
			case errors.As(err, &ae):
				status, msg = ae.status, ae.msg
			case errors.Is(err, sql.ErrNoRows):
				status, msg = http.StatusNotFound, "not found"
			default:
				log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
			}
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}
		if v == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeJSON(w, http.StatusOK, v)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4<<20))
	if err := dec.Decode(v); err != nil {
		return badRequest("invalid JSON body: %v", err)
	}
	return nil
}

func pathID(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil {
		return 0, badRequest("invalid %s", name)
	}
	return id, nil
}

func pathDate(r *http.Request) (string, error) {
	d := r.PathValue("date")
	if _, err := time.Parse("2006-01-02", d); err != nil {
		return "", badRequest("date must be YYYY-MM-DD")
	}
	return d, nil
}

func queryInt(r *http.Request, key string, def, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil || n < 0 {
		return def
	}
	if max > 0 && n > max {
		return max
	}
	return n
}

// likeTokens splits a search string into LIKE patterns, one per word.
func likeTokens(q string) []any {
	var out []any
	for _, t := range strings.Fields(strings.ToLower(q)) {
		t = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(t)
		out = append(out, "%"+t+"%")
	}
	return out
}

// placeholders returns "?,?,?" for n parameters.
func placeholders(n int) string {
	if n == 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func int64Args(ids []int64) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

// --- Static assets and media ----------------------------------------------

func (s *srv) media(w http.ResponseWriter, r *http.Request) {
	var mime string
	var data []byte
	err := s.db.QueryRowContext(r.Context(), `SELECT mime,data FROM media WHERE name=?`, r.PathValue("name")).Scan(&mime, &data)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Write(data)
}

// spa serves built assets and falls back to index.html for client-side routes.
func spa(static fs.FS) http.Handler {
	files := http.FileServer(http.FS(static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p != "" {
			if st, err := fs.Stat(static, p); err == nil && !st.IsDir() {
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(static, "index.html")
		if err != nil {
			http.Error(w, "frontend not built: run `make` (or `npm run build` in web/)", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(index)
	})
}

func recoverer(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("panic: %s %s: %v", r.Method, r.URL.Path, v)
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		h.ServeHTTP(w, r)
	})
}

// --- Meta -----------------------------------------------------------------

type named struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

func (s *srv) meta(r *http.Request) (any, error) {
	ctx := r.Context()
	out := map[string]any{}
	meals, err := queryNamed(s.db, ctx, `SELECT id,name FROM meal ORDER BY id`)
	if err != nil {
		return nil, err
	}
	types, err := queryNamed(s.db, ctx, `SELECT id,name FROM recipe_type ORDER BY name`)
	if err != nil {
		return nil, err
	}
	nutrients, err := s.nutrientDefs(ctx)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, t := range []string{"recipe", "food", "profile"} {
		var n int
		if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM `+t).Scan(&n); err != nil {
			return nil, err
		}
		counts[t+"s"] = n
	}
	var imported string
	s.db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key='imported_at'`).Scan(&imported)
	out["meals"], out["recipe_types"], out["nutrients"], out["counts"], out["imported_at"] = meals, types, nutrients, counts, imported
	return out, nil
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func queryNamed(q querier, ctx context.Context, query string, args ...any) ([]named, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []named{}
	for rows.Next() {
		var n named
		if err := rows.Scan(&n.ID, &n.Name); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
