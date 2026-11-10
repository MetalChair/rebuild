//go:build windows && portable

package main

import (
	"compress/gzip"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"dietpro/internal/server"
	"dietpro/internal/store"
	"dietpro/web"
	"golang.org/x/sys/windows"
)

//go:embed catalog.db.gz
var catalog string

func seedCatalog(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	src, err := gzip.NewReader(strings.NewReader(catalog))
	if err != nil {
		return err
	}
	defer src.Close()
	tmp, err := os.CreateTemp(filepath.Dir(path), ".dietpro-seed-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = io.Copy(tmp, src)
	if err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	from, err := windows.UTF16PtrFromString(tmp.Name())
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	// Move without replacing a database created by a concurrent launch.
	err = windows.MoveFile(from, to)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) || errors.Is(err, windows.ERROR_FILE_EXISTS) {
		return nil
	}
	return err
}

func portable() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	folder := filepath.Dir(exe)
	path := filepath.Join(folder, "DietPro.db")
	if err := seedCatalog(path); err != nil {
		return fmt.Errorf("create database in %s: %w", folder, err)
	}
	db, err := store.Open(path)
	if err != nil {
		return err
	}
	defer db.Close()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	host := listener.Addr().String()
	_, port, err := net.SplitHostPort(host)
	if err != nil {
		return err
	}
	cookieName := "dp_session_" + port
	origin := "http://" + host
	var key [24]byte
	if _, err := rand.Read(key[:]); err != nil {
		return err
	}
	token := hex.EncodeToString(key[:])
	databases := []server.Database{{Name: "Diet Pro", DB: db}}
	for _, imported := range openImportedDatabases(folder) {
		databases = append(databases, imported)
		defer imported.DB.Close()
	}
	app := server.NewMulti(databases, web.Dist())
	stopped := make(chan struct{}, 1)
	var lastSeen atomic.Int64
	lastSeen.Store(time.Now().Unix())
	srv := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != host || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != origin) ||
				r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "Local requests only", http.StatusForbidden)
				return
			}
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
			if r.URL.Path == "/launch/"+token && r.Method == http.MethodGet {
				http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
				http.Redirect(w, r, "/", http.StatusSeeOther)
				return
			}
			c, err := r.Cookie(cookieName)
			if err != nil || c.Value != token {
				http.Error(w, "Open DietPro.exe to start a session.", http.StatusUnauthorized)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("Origin") != origin {
				http.Error(w, "Same-origin requests only", http.StatusForbidden)
				return
			}
			lastSeen.Store(time.Now().Unix())
			if r.URL.Path == "/heartbeat" && r.Method == http.MethodGet {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if r.URL.Path == "/quit" && r.Method == http.MethodPost {
				w.WriteHeader(http.StatusNoContent)
				select {
				case stopped <- struct{}{}:
				default:
				}
				return
			}
			app.ServeHTTP(w, r)
		}),
	}
	result := make(chan error, 1)
	go func() { result <- srv.Serve(listener) }()
	if err := launchWindow(origin + "/launch/" + token); err != nil {
		srv.Close()
		return err
	}
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case err := <-result:
			return err
		case <-stopped:
			return shutdownServer(srv)
		case now := <-ticker.C:
			if now.Sub(time.Unix(lastSeen.Load(), 0)) >= 15*time.Minute {
				return shutdownServer(srv)
			}
		}
	}
}

func openImportedDatabases(folder string) []server.Database {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil
	}
	var databases []server.Database
	for _, entry := range entries {
		name := strings.ToLower(entry.Name())
		if !entry.Type().IsRegular() || !strings.HasPrefix(name, "dietpro-imported") || !strings.HasSuffix(name, ".db") {
			continue
		}
		path := filepath.Join(folder, entry.Name())
		if ok, _ := store.IsDietPro(path); !ok {
			continue
		}
		if db, err := store.Open(path); err == nil {
			databases = append(databases, server.Database{Name: dbName(path), DB: db})
		}
	}
	return databases
}

func launchPortableDefault() bool {
	if err := portable(); err != nil {
		showStartupError(err.Error())
	}
	return true
}
