package server

import (
	"database/sql"
	"net/http"
	"strings"
	"unicode/utf8"
)

type menuRecord struct {
	ID       int64      `json:"id"`
	Name     string     `json:"name"`
	Comments string     `json:"comments"`
	Servings float64    `json:"servings"`
	Lines    []menuLine `json:"lines"`
}

type menuLine struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	RecipeID *int64 `json:"recipe_id"`
	FoodID   *int64 `json:"food_id"`
	Quantity string `json:"quantity"`
}

func (s *srv) menus(r *http.Request) (any, error) {
	ctx := r.Context()
	rows, err := s.db.QueryContext(ctx, `SELECT m.id, m.name, m.comments, m.servings,
       l.id, l.name, l.kind, l.recipe_id, l.food_id, l.quantity
       FROM menu m LEFT JOIN menu_line l ON l.menu_id=m.id ORDER BY m.name, m.id, l.idx, l.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	menus := []menuRecord{}
	for rows.Next() {
		var m menuRecord
		var lineID sql.NullInt64
		var name, kind, qty sql.NullString
		var line menuLine
		if err := rows.Scan(&m.ID, &m.Name, &m.Comments, &m.Servings, &lineID, &name, &kind, &line.RecipeID, &line.FoodID, &qty); err != nil {
			return nil, err
		}
		if len(menus) == 0 || menus[len(menus)-1].ID != m.ID {
			m.Lines = []menuLine{}
			menus = append(menus, m)
		}
		if lineID.Valid {
			line.ID, line.Name, line.Kind, line.Quantity = lineID.Int64, name.String, kind.String, qty.String
			current := &menus[len(menus)-1]
			current.Lines = append(current.Lines, line)
		}
	}
	return menus, rows.Err()
}

type pantryRecord struct {
	ID       int64   `json:"id"`
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Comments string  `json:"comments"`
}

func (s *srv) pantry(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, name, quantity, unit, comments FROM pantry ORDER BY name, id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []pantryRecord{}
	for rows.Next() {
		var item pantryRecord
		if err := rows.Scan(&item.ID, &item.Name, &item.Quantity, &item.Unit, &item.Comments); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *srv) updatePantry(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var input struct {
		Quantity *float64 `json:"quantity"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Quantity == nil || *input.Quantity < 0 {
		return nil, badRequest("enter a nonnegative quantity")
	}
	result, err := s.db.ExecContext(r.Context(), "UPDATE pantry SET quantity=? WHERE id=?", *input.Quantity, id)
	if err != nil {
		return nil, err
	}
	if n, err := result.RowsAffected(); err != nil || n == 0 {
		if err != nil {
			return nil, err
		}
		return nil, sql.ErrNoRows
	}
	return nil, nil
}

type storeRecord struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Address  string `json:"address"`
	Comments string `json:"comments"`
}

func (s *srv) stores(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, name, address, comments FROM shopping_store ORDER BY name, id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []storeRecord{}
	for rows.Next() {
		var item storeRecord
		if err := rows.Scan(&item.ID, &item.Name, &item.Address, &item.Comments); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *srv) addMenu(r *http.Request) (any, error) {
	return s.saveMenu(r, 0)
}

func (s *srv) updateMenu(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	if id <= 0 {
		return nil, badRequest("invalid menu")
	}
	return s.saveMenu(r, id)
}

func (s *srv) saveMenu(r *http.Request, id int64) (any, error) {
	var record menuRecord
	if err := decode(r, &record); err != nil {
		return nil, err
	}
	record.Name = strings.TrimSpace(record.Name)
	record.Comments = strings.TrimSpace(record.Comments)
	if record.Name == "" || utf8.RuneCountInString(record.Name) > 160 || utf8.RuneCountInString(record.Comments) > 4000 ||
		record.Servings <= 0 || record.Servings > 10000 || len(record.Lines) > 150 {
		return nil, badRequest("enter a name, a valid serving count, and up to 150 menu items")
	}
	if record.Lines == nil {
		record.Lines = []menuLine{}
	}
	for index := range record.Lines {
		line := &record.Lines[index]
		line.Name, line.Quantity = strings.TrimSpace(line.Name), strings.TrimSpace(line.Quantity)
		if line.Name == "" || utf8.RuneCountInString(line.Name) > 240 || utf8.RuneCountInString(line.Quantity) > 80 {
			return nil, badRequest("enter a name and quantity for each menu item")
		}
		switch line.Kind {
		case "Heading", "Text":
			line.RecipeID, line.FoodID = nil, nil
		case "Recipe":
			line.FoodID = nil
		case "Ingredient":
			line.RecipeID = nil
		default:
			return nil, badRequest("unknown menu item type")
		}
	}

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if id == 0 {
		result, err := tx.ExecContext(ctx, "INSERT INTO menu(name, comments, servings) VALUES(?, ?, ?)", record.Name, record.Comments, record.Servings)
		if err != nil {
			return nil, err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
	} else {
		result, err := tx.ExecContext(ctx, "UPDATE menu SET name=?, comments=?, servings=? WHERE id=?", record.Name, record.Comments, record.Servings, id)
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
		if _, err := tx.ExecContext(ctx, "DELETE FROM menu_line WHERE menu_id=?", id); err != nil {
			return nil, err
		}
	}
	record.ID = id
	for index := range record.Lines {
		line := &record.Lines[index]
		if line.RecipeID != nil || line.FoodID != nil {
			var exists bool
			err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM recipe WHERE id=?) OR EXISTS(SELECT 1 FROM food WHERE id=?)",
				line.RecipeID, line.FoodID).Scan(&exists)
			if err != nil {
				return nil, err
			}
			if !exists {
				return nil, badRequest("a linked recipe or ingredient was removed")
			}
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO menu_line(menu_id, idx, name, kind, recipe_id, food_id, quantity)
            VALUES(?, ?, ?, ?, ?, ?, ?)`, id, index, line.Name, line.Kind, line.RecipeID, line.FoodID, line.Quantity)
		if err != nil {
			return nil, err
		}
		line.ID, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
	}
	return record, tx.Commit()
}

func (s *srv) deleteMenu(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(r.Context(), "DELETE FROM menu WHERE id=?", id)
	return nil, err
}
