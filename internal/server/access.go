package server

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"dietpro/internal/importer"
	"dietpro/internal/store"
)

const maxLegacyMDB = 256 << 20

func (s *srv) importAccess(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Content-Type") != "application/octet-stream" {
		http.Error(w, "Choose a Diet Pro .mdb file.", http.StatusUnsupportedMediaType)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Minute)
	defer cancel()
	folder, err := os.MkdirTemp("", "dietpro-import-*")
	if err != nil {
		http.Error(w, "Could not create temporary import storage.", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(folder)
	input := filepath.Join(folder, "legacy.mdb")
	if err := saveLegacyUpload(w, r, input); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "Choose a database up to 256 MB.", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "Could not read the selected database.", http.StatusBadRequest)
		}
		return
	}
	if err := importer.ExportAccess(ctx, input, folder); err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	destination := filepath.Join(folder, "DietPro.db")
	db, err := store.Open(destination)
	if err != nil {
		http.Error(w, "Could not create the converted database.", http.StatusInternalServerError)
		return
	}
	defer db.Close()
	if err := importer.Run(db, importer.Options{CSVDir: folder}); err != nil {
		// Access fields may contain personal information. Do not log raw values.
		http.Error(w, "This file opened, but its records did not match the supported Diet Pro format.", http.StatusUnprocessableEntity)
		return
	}
	if _, err := db.ExecContext(ctx, "UPDATE meta SET value='Diet Pro Access import' WHERE key='import_source'"); err != nil {
		http.Error(w, "Could not finish the converted database.", http.StatusInternalServerError)
		return
	}
	var profiles, entries, recipes int
	err = db.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM profile), (SELECT count(*) FROM diary_entry), (SELECT count(*) FROM recipe)").Scan(&profiles, &entries, &recipes)
	if err != nil {
		http.Error(w, "Could not verify the converted database.", http.StatusInternalServerError)
		return
	}
	if err := db.Close(); err != nil {
		http.Error(w, "Could not finish the converted database.", http.StatusInternalServerError)
		return
	}
	file, err := os.Open(destination)
	if err != nil {
		log.Print("Diet Pro import: could not reopen converted database")
		http.Error(w, "Could not open the converted database.", http.StatusInternalServerError)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=DietPro-imported.db")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-DietPro-Imported-Profiles", strconv.Itoa(profiles))
	w.Header().Set("X-DietPro-Imported-Entries", strconv.Itoa(entries))
	w.Header().Set("X-DietPro-Imported-Recipes", strconv.Itoa(recipes))
	http.ServeContent(w, r, "DietPro-imported.db", time.Time{}, file)
}

func saveLegacyUpload(w http.ResponseWriter, r *http.Request, path string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, http.MaxBytesReader(w, r.Body, maxLegacyMDB))
	closeErr := file.Close()
	return errors.Join(copyErr, closeErr)
}
