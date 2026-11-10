package server

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

type grocery struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Quantity string `json:"quantity"`
	Checked  bool   `json:"checked"`
}

func groceryListID(r *http.Request) (int64, error) {
	value := r.URL.Query().Get("list")
	if value == "" {
		return 1, nil
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id < 1 {
		return 0, badRequest("invalid grocery list")
	}
	return id, nil
}

func (s *srv) groceries(r *http.Request) (any, error) {
	id, err := groceryListID(r)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT g.id, g.name, g.quantity, g.checked FROM grocery g
        JOIN grocery_list_item li ON li.item_id=g.id WHERE li.list_id=? ORDER BY g.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []grocery{}
	for rows.Next() {
		var item grocery
		if err := rows.Scan(&item.ID, &item.Name, &item.Quantity, &item.Checked); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *srv) addGrocery(r *http.Request) (any, error) {
	listID, err := groceryListID(r)
	if err != nil {
		return nil, err
	}
	var items []grocery
	if err := decode(r, &items); err != nil {
		return nil, err
	}
	if len(items) == 0 || len(items) > 500 {
		return nil, badRequest("enter between 1 and 500 grocery items")
	}
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		quantity := strings.TrimSpace(item.Quantity)
		if name == "" || utf8.RuneCountInString(name) > 200 || utf8.RuneCountInString(quantity) > 80 {
			return nil, badRequest("enter an item name up to 200 characters and a quantity up to 80 characters")
		}
		result, err := tx.ExecContext(ctx, "INSERT INTO grocery (name, quantity) VALUES (?, ?)", name, quantity)
		if err != nil {
			return nil, err
		}
		itemID, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		membership, err := tx.ExecContext(ctx, `INSERT INTO grocery_list_item(item_id, list_id)
            SELECT ?, id FROM grocery_list WHERE id=?`, itemID, listID)
		if err != nil {
			return nil, err
		}
		if affected, err := membership.RowsAffected(); err != nil {
			return nil, err
		} else if affected == 0 {
			return nil, sql.ErrNoRows
		}
	}
	return nil, tx.Commit()
}

func (s *srv) checkGrocery(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var input struct {
		Checked *bool `json:"checked"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Checked == nil {
		return nil, badRequest("checked is required")
	}
	_, err = s.db.ExecContext(r.Context(), "UPDATE grocery SET checked = ? WHERE id = ?", *input.Checked, id)
	return nil, err
}

func (s *srv) deleteGrocery(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(r.Context(), "DELETE FROM grocery WHERE id = ?", id)
	return nil, err
}

type groceryList struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

func (s *srv) groceryLists(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT id, name FROM grocery_list ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lists := []groceryList{}
	for rows.Next() {
		var list groceryList
		if err := rows.Scan(&list.ID, &list.Name); err != nil {
			return nil, err
		}
		lists = append(lists, list)
	}
	return lists, rows.Err()
}

func readGroceryListName(r *http.Request) (string, error) {
	var input groceryList
	if err := decode(r, &input); err != nil {
		return "", err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return "", badRequest("enter a list name up to 120 characters")
	}
	return name, nil
}

func (s *srv) addGroceryList(r *http.Request) (any, error) {
	name, err := readGroceryListName(r)
	if err != nil {
		return nil, err
	}
	result, err := s.db.ExecContext(r.Context(), "INSERT INTO grocery_list(name) VALUES(?)", name)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	return groceryList{ID: id, Name: name}, err
}

func (s *srv) renameGroceryList(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	name, err := readGroceryListName(r)
	if err != nil {
		return nil, err
	}
	result, err := s.db.ExecContext(r.Context(), "UPDATE grocery_list SET name=? WHERE id=?", name, id)
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
	return groceryList{ID: id, Name: name}, nil
}

func (s *srv) deleteGroceryList(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	if id == 1 {
		return nil, badRequest("the default grocery list cannot be removed")
	}
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM grocery WHERE id IN (SELECT item_id FROM grocery_list_item WHERE list_id=?)", id); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM grocery_list WHERE id=?", id); err != nil {
		return nil, err
	}
	return nil, tx.Commit()
}
