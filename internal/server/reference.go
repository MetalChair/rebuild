package server

import "net/http"

type glossaryItem struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Text    string `json:"text"`
	Source  string `json:"source"`
	Webpage string `json:"webpage"`
}

// glossary returns every term; the list is small enough to filter client-side.
func (s *srv) glossary(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,name,text,source,webpage FROM glossary WHERE text<>'' ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []glossaryItem{}
	for rows.Next() {
		var g glossaryItem
		if err := rows.Scan(&g.ID, &g.Name, &g.Text, &g.Source, &g.Webpage); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

type techniqueSummary struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"`
}

func (s *srv) techniques(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,name,group_name FROM technique ORDER BY group_name, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []techniqueSummary{}
	for rows.Next() {
		var t techniqueSummary
		if err := rows.Scan(&t.ID, &t.Name, &t.Group); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

type techniqueStep struct {
	Text     string `json:"text"`
	Photo    string `json:"photo"`
	Numbered bool   `json:"numbered"`
}

func (s *srv) technique(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var t struct {
		techniqueSummary
		Source   string          `json:"source"`
		Webpage  string          `json:"webpage"`
		Comments string          `json:"comments"`
		Steps    []techniqueStep `json:"steps"`
	}
	t.Steps = []techniqueStep{}
	if err := s.db.QueryRowContext(r.Context(), `SELECT id,name,group_name,source,webpage,comments FROM technique WHERE id=?`, id).Scan(
		&t.ID, &t.Name, &t.Group, &t.Source, &t.Webpage, &t.Comments); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT text,photo,numbered FROM technique_step WHERE technique_id=? ORDER BY idx, id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st techniqueStep
		if err := rows.Scan(&st.Text, &st.Photo, &st.Numbered); err != nil {
			return nil, err
		}
		t.Steps = append(t.Steps, st)
	}
	return t, rows.Err()
}
