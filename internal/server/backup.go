package server

import (
	"net/http"
	"os"
	"time"
)

func (s *srv) backup(w http.ResponseWriter, r *http.Request) {
	temp, err := os.CreateTemp("", "dietpro-backup-*.db")
	if err != nil {
		http.Error(w, "Could not create the backup file.", http.StatusInternalServerError)
		return
	}
	defer os.Remove(temp.Name())
	if err := temp.Close(); err != nil {
		http.Error(w, "Could not prepare the backup file.", http.StatusInternalServerError)
		return
	}
	// VACUUM INTO includes committed changes in the write-ahead log.
	if _, err := s.db.ExecContext(r.Context(), "VACUUM INTO ?", temp.Name()); err != nil {
		http.Error(w, "Could not copy the database.", http.StatusInternalServerError)
		return
	}
	source, err := os.Open(temp.Name())
	if err != nil {
		http.Error(w, "Could not open the backup file.", http.StatusInternalServerError)
		return
	}
	defer source.Close()
	filename := "DietPro-backup-" + time.Now().Format("2006-01-02-150405") + ".db"
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, filename, time.Time{}, source)
}
