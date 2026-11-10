package server

import (
	"bytes"
	"database/sql"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const maxPhotoSize = 12 << 20

type profilePhoto struct {
	ID      int64  `json:"id"`
	Date    string `json:"date"`
	Caption string `json:"caption"`
}

func (s *srv) profilePhotos(r *http.Request) (any, error) {
	profileID, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, date, caption FROM profile_photo WHERE profile_id=? ORDER BY date, id", profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	photos := []profilePhoto{}
	for rows.Next() {
		var photo profilePhoto
		if err := rows.Scan(&photo.ID, &photo.Date, &photo.Caption); err != nil {
			return nil, err
		}
		photos = append(photos, photo)
	}
	return photos, rows.Err()
}

func (s *srv) addProfilePhoto(r *http.Request) (any, error) {
	profileID, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	date := r.URL.Query().Get("date")
	if _, err := time.Parse(time.DateOnly, date); err != nil {
		return nil, badRequest("choose a date for the photograph")
	}
	caption := strings.TrimSpace(r.URL.Query().Get("caption"))
	if utf8.RuneCountInString(caption) > 180 {
		return nil, badRequest("enter a caption up to 180 characters")
	}
	data, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxPhotoSize))
	if err != nil {
		return nil, badRequest("choose a photograph up to 12 MB")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 60_000_000 {
		return nil, badRequest("choose a JPEG, PNG, or GIF photograph up to 60 megapixels")
	}
	mime := "image/" + format
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO profile_photo(profile_id, date, caption, mime, data)
        SELECT id, ?, ?, ?, ? FROM profile WHERE id=?`, date, caption, mime, data, profileID)
	if err != nil {
		return nil, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, sql.ErrNoRows
	}
	id, err := result.LastInsertId()
	return profilePhoto{ID: id, Date: date, Caption: caption}, err
}

func (s *srv) getProfilePhoto(w http.ResponseWriter, r *http.Request) {
	profileID, idErr := pathID(r, "id")
	photoID, photoErr := pathID(r, "photo")
	if idErr != nil || photoErr != nil {
		http.Error(w, "Invalid photograph.", http.StatusBadRequest)
		return
	}
	var mime string
	var data []byte
	err := s.db.QueryRowContext(r.Context(), "SELECT mime, data FROM profile_photo WHERE id=? AND profile_id=?", photoID, profileID).Scan(&mime, &data)
	if err == sql.ErrNoRows {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "Could not read photograph.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "photograph", time.Time{}, bytes.NewReader(data))
}

func (s *srv) deleteProfilePhoto(r *http.Request) (any, error) {
	profileID, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	photoID, err := pathID(r, "photo")
	if err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(r.Context(), "DELETE FROM profile_photo WHERE id=? AND profile_id=?", photoID, profileID)
	return nil, err
}
