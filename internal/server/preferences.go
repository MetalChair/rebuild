package server

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (s *srv) preferences(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT key, value FROM preference")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		if json.Valid([]byte(value)) {
			values[key] = json.RawMessage(value)
		}
	}
	return values, rows.Err()
}

func (s *srv) setPreference(r *http.Request) (any, error) {
	key := r.PathValue("key")
	if !strings.HasPrefix(key, "dp.") || len(key) > 120 {
		return nil, badRequest("invalid preference name")
	}
	var value json.RawMessage
	if err := decode(r, &value); err != nil {
		return nil, err
	}
	if len(value) > 500 {
		return nil, badRequest("preference too large")
	}
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO preference(key, value) VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, string(value))
	return nil, err
}
