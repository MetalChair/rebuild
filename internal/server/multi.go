package server

import (
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"strings"
)

// Database is one Diet Pro database served by NewMulti.
type Database struct {
	Name string // shown in the UI and used to select it; the file name without ".db"
	DB   *sql.DB
}

// DBHeader names the database an API request is for. Values are
// URL-encoded so any file name survives as a header. Media requests, which
// come from <img> tags and can't set headers, use the "db" query parameter.
const DBHeader = "X-Diet-Pro-DB"

// NewMulti serves several databases from one server. Each request picks its
// database with DBHeader or ?db=; requests that name none get the first
// database (the default). GET /api/databases lists them.
func NewMulti(dbs []Database, static fs.FS) http.Handler {
	handlers := make(map[string]http.Handler, len(dbs))
	names := make([]string, len(dbs))
	for i, d := range dbs {
		handlers[d.Name] = New(d.DB, static)
		names[i] = d.Name
	}
	list, _ := json.Marshal(map[string]any{"databases": names, "default": names[0]})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/databases" {
			if r.Method != http.MethodGet {
				writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.Write(list)
			return
		}
		name := r.URL.Query().Get("db")
		if h := r.Header.Get(DBHeader); h != "" {
			if dec, err := url.PathUnescape(h); err == nil {
				name = dec
			}
		}
		if name == "" {
			name = names[0]
		}
		h, ok := handlers[name]
		if !ok {
			// The UI and its static files are the same for every database.
			if !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/media/") {
				handlers[names[0]].ServeHTTP(w, r)
				return
			}
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown database " + name})
			return
		}
		h.ServeHTTP(w, r)
	})
}
