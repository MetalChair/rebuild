// Command dietpro is a self-contained recipe and nutrition tracker: a single
// binary serving a web UI backed by an SQLite file.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"dietpro/internal/importer"
	"dietpro/internal/server"
	"dietpro/internal/store"
	"dietpro/web"
)

var version = "dev"

const usage = `Diet Pro %s

Usage:
  dietpro [serve] [flags]     Start the web app (default); -dir <folder> serves every database in a folder
  dietpro import [flags]      Import a legacy Diet Pro CSV export into a new database
  dietpro version

Run "dietpro <command> -h" for flags.
`

func main() {
	log.SetFlags(0)
	args := os.Args[1:]
	if len(args) == 0 && launchPortableDefault() {
		return
	}
	cmd := "serve"
	if len(args) > 0 && args[0] != "" && args[0][0] != '-' {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve(args)
	case "import":
		err = runImport(args)
	case "version":
		fmt.Println(version)
	case "help":
		fmt.Printf(usage, version)
	default:
		fmt.Fprintf(os.Stderr, usage, version)
		os.Exit(2)
	}
	if err != nil {
		log.Fatal("error: ", err)
	}
}

func runImport(args []string) error {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	csvDir := fs.String("csv", "", "directory containing the legacy t_*.csv export (required)")
	images := fs.String("images", "", "legacy Diet Pro Images directory (optional)")
	dbPath := fs.String("db", "dietpro.db", "database file to create")
	force := fs.Bool("force", false, "overwrite the database file if it exists")
	fs.Parse(args)
	if *csvDir == "" {
		fs.Usage()
		return errors.New("-csv is required")
	}
	if _, err := os.Stat(*dbPath); err == nil {
		if !*force {
			return fmt.Errorf("%s already exists (use -force to replace it)", *dbPath)
		}
		for _, suffix := range []string{"", "-wal", "-shm"} {
			os.Remove(*dbPath + suffix)
		}
	}
	db, err := store.Open(*dbPath)
	if err != nil {
		return err
	}
	defer db.Close()
	fmt.Printf("Importing %s into %s\n", *csvDir, *dbPath)
	start := time.Now()
	if err := importer.Run(db, importer.Options{CSVDir: *csvDir, ImagesDir: *images, Log: os.Stdout}); err != nil {
		db.Close()
		os.Remove(*dbPath)
		return err
	}
	if _, err := db.Exec(`VACUUM`); err != nil {
		return err
	}
	fmt.Printf("Done in %s\n", time.Since(start).Round(time.Millisecond))
	return nil
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dbPath := fs.String("db", "dietpro.db", "database file")
	dir := fs.String("dir", "", "serve every Diet Pro database (*.db) in this folder, with a picker to switch (instead of -db)")
	defaultDB := fs.String("default", "dietpro", "with -dir: the database selected first (file name without .db)")
	addr := fs.String("addr", "127.0.0.1:7465", "listen address")
	open := fs.Bool("open", false, "open the app in the default browser")
	fs.Parse(args)

	var dbs []server.Database
	var err error
	if *dir != "" {
		dbSet := false
		fs.Visit(func(f *flag.Flag) { dbSet = dbSet || f.Name == "db" })
		if dbSet {
			return errors.New("use either -db or -dir, not both")
		}
		dbs, err = openDir(*dir, *defaultDB)
	} else {
		if _, err := os.Stat(*dbPath); errors.Is(err, os.ErrNotExist) {
			log.Printf("Note: %s does not exist; starting with an empty database.", *dbPath)
			log.Printf("      Run \"dietpro import -csv <export dir>\" to load legacy data.")
		}
		var db *sql.DB
		db, err = store.Open(*dbPath)
		if err == nil {
			dbs = []server.Database{{Name: dbName(*dbPath), DB: db}}
		}
	}
	if err != nil {
		return err
	}
	defer func() {
		for _, d := range dbs {
			d.DB.Close()
		}
	}()

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: server.NewMulti(dbs, web.Dist()), ReadHeaderTimeout: 10 * time.Second}
	url := "http://" + ln.Addr().String()
	if *dir != "" {
		log.Printf("Diet Pro %s serving %d databases from %s at %s", version, len(dbs), *dir, url)
	} else {
		log.Printf("Diet Pro %s serving %s at %s", version, *dbPath, url)
	}
	if *open {
		openBrowser(url)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// openDir opens every Diet Pro database in dir, sorted by name with def first.
// Files that aren't Diet Pro databases (other apps' SQLite files, anything
// unreadable) are skipped with a message and never written to.
func openDir(dir, def string) ([]server.Database, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.db"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	var dbs []server.Database
	for _, p := range paths {
		if st, err := os.Stat(p); err != nil || !st.Mode().IsRegular() {
			continue
		}
		if ok, err := store.IsDietPro(p); !ok {
			reason := "not a Diet Pro database"
			if err != nil {
				reason = err.Error()
			}
			log.Printf("Skipping %s: %s", p, reason)
			continue
		}
		db, err := store.Open(p)
		if err != nil {
			for _, d := range dbs {
				d.DB.Close()
			}
			return nil, fmt.Errorf("%s: %w", p, err)
		}
		d := server.Database{Name: dbName(p), DB: db}
		if d.Name == def {
			dbs = append([]server.Database{d}, dbs...)
		} else {
			dbs = append(dbs, d)
		}
		log.Printf("Loaded %s", p)
	}
	if len(dbs) == 0 {
		return nil, fmt.Errorf("no Diet Pro databases (*.db) found in %s", dir)
	}
	return dbs, nil
}

// dbName is how a database is labelled in the app: its file name without ".db".
func dbName(path string) string {
	return strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
