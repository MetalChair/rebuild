package server

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"dietpro/internal/store"
)

// New foods get IDs at or above this so they never collide with USDA NDB numbers.
const firstUserFoodID = 1_000_000

type foodGroup struct {
	ID       int64  `json:"id"`
	ParentID int64  `json:"parent_id"`
	Name     string `json:"name"`
	Count    int    `json:"count"`
}

func (s *srv) foodGroups(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT g.id, g.parent_id, g.name,
		(SELECT count(*) FROM food_group_member m WHERE m.group_id=g.id) FROM food_group g ORDER BY g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []foodGroup{}
	for rows.Next() {
		var g foodGroup
		if err := rows.Scan(&g.ID, &g.ParentID, &g.Name, &g.Count); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

type foodSummary struct {
	ID              int64    `json:"id"`
	Name            string   `json:"name"`
	CommonName      string   `json:"common_name"`
	NutritionSource string   `json:"nutrition_source"`
	IsUser          bool     `json:"is_user"`
	Calories        *float64 `json:"calories"`
}

func (s *srv) listFoods(r *http.Request) (any, error) {
	ctx := r.Context()
	q := r.URL.Query()
	var where []string
	var args []any
	for _, t := range likeTokens(q.Get("q")) {
		where = append(where, `(lower(f.name) LIKE ? ESCAPE '\' OR lower(f.common_name) LIKE ? ESCAPE '\')`)
		args = append(args, t, t)
	}
	if g := q.Get("group"); g != "" {
		where = append(where, `f.id IN (SELECT food_id FROM food_group_member WHERE group_id IN (
			WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT fg.id FROM food_group fg JOIN sub ON fg.parent_id=sub.id) SELECT id FROM sub))`)
		args = append(args, g)
	}
	if q.Get("user") == "1" {
		where = append(where, `f.is_user=1`)
	}
	cond := ""
	if len(where) > 0 {
		cond = " WHERE " + strings.Join(where, " AND ")
	}
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM food f`+cond, args...).Scan(&total); err != nil {
		return nil, err
	}
	order := "f.name COLLATE NOCASE"
	orderArgs := []any{}
	if term := strings.TrimSpace(strings.ToLower(q.Get("q"))); term != "" {
		// Prefer names that start with the query, then shorter (more generic) names.
		order = "(lower(f.name) LIKE ? ESCAPE '\\') DESC, (lower(f.common_name) LIKE ? ESCAPE '\\') DESC, length(f.name), f.name COLLATE NOCASE"
		prefix := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%"
		orderArgs = append(orderArgs, prefix, prefix)
	}
	limit, offset := queryInt(r, "limit", 50, 200), queryInt(r, "offset", 0, 0)
	rows, err := s.db.QueryContext(ctx, `SELECT f.id,f.name,f.common_name,f.nutrition_source,f.is_user,
		(SELECT amount FROM food_nutrient n WHERE n.food_id=f.id AND n.nutrient='calories')
		FROM food f`+cond+` ORDER BY `+order+fmt.Sprintf(` LIMIT %d OFFSET %d`, limit, offset), append(args, orderArgs...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []foodSummary{}
	for rows.Next() {
		var f foodSummary
		if err := rows.Scan(&f.ID, &f.Name, &f.CommonName, &f.NutritionSource, &f.IsUser, &f.Calories); err != nil {
			return nil, err
		}
		items = append(items, f)
	}
	return map[string]any{"total": total, "items": items}, rows.Err()
}

type foodMeasure struct {
	ID          int64   `json:"id"`
	Description string  `json:"description"`
	Grams       float64 `json:"grams"`
}

type foodDetail struct {
	ID               int64         `json:"id"`
	Name             string        `json:"name"`
	CommonName       string        `json:"common_name"`
	GroupID          int64         `json:"group_id"`
	NutritionSource  string        `json:"nutrition_source"`
	IsUser           bool          `json:"is_user"`
	Source           string        `json:"source"`
	Webpage          string        `json:"webpage"`
	Comments         string        `json:"comments"`
	Refuse           *float64      `json:"refuse"`
	DefaultMeasureID int64         `json:"default_measure_id"`
	Nutrients        Nutr          `json:"nutrients"` // per 100 g
	Measures         []foodMeasure `json:"measures"`
	Groups           []named       `json:"groups"`
	Notes            []string      `json:"notes"`
	UsedIn           []named       `json:"used_in"`
}

func (s *srv) getFood(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	return s.loadFood(r.Context(), id)
}

func (s *srv) loadFood(ctx context.Context, id int64) (*foodDetail, error) {
	f := &foodDetail{Notes: []string{}}
	err := s.db.QueryRowContext(ctx, `SELECT id,name,common_name,group_id,nutrition_source,is_user,source,webpage,comments,refuse,default_measure_id
		FROM food WHERE id=?`, id).Scan(&f.ID, &f.Name, &f.CommonName, &f.GroupID, &f.NutritionSource, &f.IsUser, &f.Source,
		&f.Webpage, &f.Comments, &f.Refuse, &f.DefaultMeasureID)
	if err != nil {
		return nil, err
	}
	nut, err := s.foodNutrients(ctx, []int64{id})
	if err != nil {
		return nil, err
	}
	f.Nutrients = nut[id]
	if f.Nutrients == nil {
		f.Nutrients = Nutr{}
	}
	if f.Measures, err = s.foodMeasures(ctx, id, f.DefaultMeasureID); err != nil {
		return nil, err
	}
	if f.Groups, err = queryNamed(s.db, ctx, `SELECT g.id,g.name FROM food_group_member m JOIN food_group g ON g.id=m.group_id
		WHERE m.food_id=? ORDER BY g.name`, id); err != nil {
		return nil, err
	}
	if f.UsedIn, err = queryNamed(s.db, ctx, `SELECT DISTINCT r.id,r.name FROM recipe_ingredient i JOIN recipe r ON r.id=i.recipe_id
		WHERE i.food_id=? ORDER BY r.name COLLATE NOCASE LIMIT 50`, id); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT text FROM food_note WHERE food_id=? ORDER BY idx`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		f.Notes = append(f.Notes, t)
	}
	return f, rows.Err()
}

func (s *srv) foodMeasures(ctx context.Context, id, defaultID int64) ([]foodMeasure, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT m.id, m.description, fm.grams FROM food_measure fm JOIN measure m ON m.id=fm.measure_id
		WHERE fm.food_id=? ORDER BY CASE WHEN m.id=? THEN 0 WHEN m.id IN (?,100000) THEN 2 ELSE 1 END, fm.grams`,
		id, defaultID, store.GramMeasureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []foodMeasure{}
	for rows.Next() {
		var m foodMeasure
		if err := rows.Scan(&m.ID, &m.Description, &m.Grams); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type foodInput struct {
	Name       string              `json:"name"`
	CommonName string              `json:"common_name"`
	GroupID    int64               `json:"group_id"`
	Source     string              `json:"source"`
	Webpage    string              `json:"webpage"`
	Comments   string              `json:"comments"`
	Nutrients  map[string]*float64 `json:"nutrients"` // per 100 g; null removes
	Measures   []struct {
		ID          int64   `json:"id"`
		Description string  `json:"description"`
		Grams       float64 `json:"grams"`
	} `json:"measures"`
	DefaultMeasureID int64 `json:"default_measure_id"`
}

func (s *srv) createFood(r *http.Request) (any, error) {
	var in foodInput
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var id int64
	if err := tx.QueryRow(`SELECT max(COALESCE(max(id),0)+1, ?) FROM food`, firstUserFoodID).Scan(&id); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO food(id,name,nutrition_source,is_user) VALUES(?,?,'User',1)`, id, "new"); err != nil {
		return nil, err
	}
	if err := saveFood(tx, id, &in); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.loadFood(r.Context(), id)
}

func (s *srv) updateFood(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var in foodInput
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM food WHERE id=?`, id).Scan(&exists); err != nil {
		return nil, err
	}
	if err := saveFood(tx, id, &in); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.loadFood(r.Context(), id)
}

func saveFood(tx *sql.Tx, id int64, in *foodInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return badRequest("name is required")
	}
	if _, err := tx.Exec(`UPDATE food SET name=?,common_name=?,group_id=?,source=?,webpage=?,comments=?,default_measure_id=? WHERE id=?`,
		in.Name, strings.TrimSpace(in.CommonName), in.GroupID, in.Source, in.Webpage, in.Comments, in.DefaultMeasureID, id); err != nil {
		return err
	}
	if in.GroupID != 0 {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO food_group_member(group_id,food_id) VALUES(?,?)`, in.GroupID, id); err != nil {
			return err
		}
	}
	if in.Nutrients != nil {
		known := map[string]bool{}
		for _, n := range store.Nutrients {
			known[n.Key] = true
		}
		for k, v := range in.Nutrients {
			if !known[k] {
				return badRequest("unknown nutrient %q", k)
			}
			var err error
			if v == nil {
				_, err = tx.Exec(`DELETE FROM food_nutrient WHERE food_id=? AND nutrient=?`, id, k)
			} else {
				_, err = tx.Exec(`INSERT INTO food_nutrient(food_id,nutrient,amount) VALUES(?,?,?)
					ON CONFLICT(food_id,nutrient) DO UPDATE SET amount=excluded.amount`, id, k, *v)
			}
			if err != nil {
				return err
			}
		}
	}
	if in.Measures != nil {
		if _, err := tx.Exec(`DELETE FROM food_measure WHERE food_id=?`, id); err != nil {
			return err
		}
		for _, m := range in.Measures {
			if m.Grams <= 0 {
				continue
			}
			mid := m.ID
			if mid == 0 {
				desc := strings.TrimSpace(m.Description)
				if desc == "" {
					continue
				}
				var err error
				if mid, err = ensureMeasure(tx, desc); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(`INSERT OR REPLACE INTO food_measure(food_id,measure_id,grams) VALUES(?,?,?)`, id, mid, m.Grams); err != nil {
				return err
			}
		}
		// Weight in grams is always available.
		if _, err := tx.Exec(`INSERT OR REPLACE INTO food_measure(food_id,measure_id,grams) VALUES(?,?,1)`, id, store.GramMeasureID); err != nil {
			return err
		}
	}
	return nil
}

// ensureMeasure finds a measure by description or creates one.
func ensureMeasure(tx *sql.Tx, desc string) (int64, error) {
	var id int64
	err := tx.QueryRow(`SELECT id FROM measure WHERE description=? COLLATE NOCASE ORDER BY id LIMIT 1`, desc).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	unit := strings.TrimSpace(strings.TrimPrefix(desc, "1 "))
	res, err := tx.Exec(`INSERT INTO measure(description,type,unit_singular,unit_plural) VALUES(?,'Unit',?,?)`, desc, unit, unit)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *srv) deleteFood(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var recipes, entries int
	if err := s.db.QueryRowContext(r.Context(), `SELECT (SELECT count(DISTINCT recipe_id) FROM recipe_ingredient WHERE food_id=?1),
		(SELECT count(*) FROM diary_entry WHERE food_id=?1)`, id).Scan(&recipes, &entries); err != nil {
		return nil, err
	}
	if recipes+entries > 0 {
		return nil, errStatus(http.StatusConflict, "this ingredient is used by %d recipes and %d diary entries", recipes, entries)
	}
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM food WHERE id=?`, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, sql.ErrNoRows
	}
	return nil, nil
}
