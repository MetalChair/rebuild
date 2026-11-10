package server

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

type savedLink struct {
	ID      int64  `json:"id"`
	Section string `json:"section"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Target  string `json:"target"`
}

func (s *srv) savedLinks(r *http.Request) (any, error) {
	section, kind := r.URL.Query().Get("section"), r.URL.Query().Get("kind")
	if (section != "cooking" && section != "exercise") || (kind != "favorite" && kind != "search") {
		return nil, badRequest("invalid saved items section")
	}
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, title, target FROM saved_link WHERE section=? AND kind=? ORDER BY title COLLATE NOCASE, id", section, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	links := []savedLink{}
	for rows.Next() {
		item := savedLink{Section: section, Kind: kind}
		if err := rows.Scan(&item.ID, &item.Title, &item.Target); err != nil {
			return nil, err
		}
		links = append(links, item)
	}
	return links, rows.Err()
}

func (s *srv) addSavedLink(r *http.Request) (any, error) {
	var item savedLink
	if err := decode(r, &item); err != nil {
		return nil, err
	}
	item.Title = strings.TrimSpace(item.Title)
	if item.Title == "" || utf8.RuneCountInString(item.Title) > 200 || len(item.Target) > 1500 {
		return nil, badRequest("enter a title up to 200 characters")
	}
	target, err := url.ParseRequestURI(item.Target)
	if err != nil || target.IsAbs() || target.Host != "" || !validSavedTarget(item.Section, item.Kind, target) {
		return nil, badRequest("choose a Diet Pro item or search")
	}
	target.RawQuery = target.Query().Encode()
	item.Target = target.String()
	err = s.db.QueryRowContext(r.Context(), `INSERT INTO saved_link(section, kind, title, target) VALUES(?, ?, ?, ?)
        ON CONFLICT(section, kind, target) DO UPDATE SET title=excluded.title RETURNING id`,
		item.Section, item.Kind, item.Title, item.Target).Scan(&item.ID)
	return item, err
}

func validSavedTarget(section, kind string, target *url.URL) bool {
	if section == "exercise" && (kind == "search" || kind == "favorite") {
		return target.Path == "/activities" && strings.TrimSpace(target.Query().Get("q")) != ""
	}
	if section != "cooking" {
		return false
	}
	if kind == "search" {
		return (target.Path == "/recipes" || target.Path == "/foods") && len(target.Query()) > 0
	}
	if kind != "favorite" || target.RawQuery != "" {
		return false
	}
	parts := strings.Split(target.Path, "/")
	if len(parts) != 3 || (parts[1] != "recipes" && parts[1] != "foods") {
		return false
	}
	id, err := strconv.ParseInt(parts[2], 10, 64)
	return err == nil && id > 0
}

func (s *srv) deleteSavedLink(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(r.Context(), "DELETE FROM saved_link WHERE id=?", id)
	return nil, err
}
