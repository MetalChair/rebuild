package server

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

type cookbookGroup struct {
	ID       int64  `json:"id"`
	ParentID int64  `json:"parent_id"`
	Name     string `json:"name"`
	Count    int    `json:"count"`
}

type cookbook struct {
	ID     int64           `json:"id"`
	Name   string          `json:"name"`
	Count  int             `json:"count"`
	Groups []cookbookGroup `json:"groups"`
}

func (s *srv) cookbooks(r *http.Request) (any, error) {
	ctx := r.Context()
	rows, err := s.db.QueryContext(ctx, `SELECT c.id, c.name,
		(SELECT count(DISTINCT m.recipe_id) FROM recipe_group_member m JOIN recipe_group g ON g.id=m.group_id WHERE g.cookbook_id=c.id)
		FROM cookbook c ORDER BY c.name`)
	if err != nil {
		return nil, err
	}
	var books []*cookbook
	byID := map[int64]*cookbook{}
	for rows.Next() {
		b := &cookbook{Groups: []cookbookGroup{}}
		if err := rows.Scan(&b.ID, &b.Name, &b.Count); err != nil {
			rows.Close()
			return nil, err
		}
		books = append(books, b)
		byID[b.ID] = b
	}
	rows.Close()

	rows, err = s.db.QueryContext(ctx, `SELECT g.id, g.parent_id, g.cookbook_id, g.name,
		(SELECT count(*) FROM recipe_group_member m WHERE m.group_id=g.id)
		FROM recipe_group g ORDER BY g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var g cookbookGroup
		var book int64
		if err := rows.Scan(&g.ID, &g.ParentID, &book, &g.Name, &g.Count); err != nil {
			return nil, err
		}
		if b := byID[book]; b != nil {
			b.Groups = append(b.Groups, g)
		}
	}
	if books == nil {
		books = []*cookbook{}
	}
	return books, rows.Err()
}

type recipeSummary struct {
	ID       int64    `json:"id"`
	Name     string   `json:"name"`
	Subtitle string   `json:"subtitle"`
	Photo    string   `json:"photo"`
	Servings float64  `json:"servings"`
	Minutes  int      `json:"minutes"`
	Types    string   `json:"types"`
	Rating   *float64 `json:"rating"`
	Source   string   `json:"source"`
	Calories *float64 `json:"calories"`
}

func (s *srv) listRecipes(r *http.Request) (any, error) {
	ctx := r.Context()
	q := r.URL.Query()
	var where []string
	var args []any
	for _, t := range likeTokens(q.Get("q")) {
		where = append(where, `(lower(r.name) LIKE ? ESCAPE '\' OR lower(r.types) LIKE ? ESCAPE '\' OR lower(r.source) LIKE ? ESCAPE '\'
			OR EXISTS(SELECT 1 FROM recipe_ingredient i WHERE i.recipe_id=r.id AND lower(i.text) LIKE ? ESCAPE '\'))`)
		args = append(args, t, t, t, t)
	}
	if g := q.Get("group"); g != "" {
		where = append(where, `r.id IN (SELECT recipe_id FROM recipe_group_member WHERE group_id IN (
			WITH RECURSIVE sub(id) AS (SELECT ? UNION SELECT rg.id FROM recipe_group rg JOIN sub ON rg.parent_id=sub.id) SELECT id FROM sub))`)
		args = append(args, g)
	}
	if b := q.Get("cookbook"); b != "" {
		where = append(where, `r.id IN (SELECT m.recipe_id FROM recipe_group_member m JOIN recipe_group g ON g.id=m.group_id WHERE g.cookbook_id=?)`)
		args = append(args, b)
	}
	if t := q.Get("type"); t != "" {
		where = append(where, `(', '||r.types||', ') LIKE ?`)
		args = append(args, "%, "+t+", %")
	}
	if q.Get("photo") == "1" {
		where = append(where, `r.photo<>''`)
	}
	cond := ""
	if len(where) > 0 {
		cond = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM recipe r`+cond, args...).Scan(&total); err != nil {
		return nil, err
	}
	order := "r.name COLLATE NOCASE"
	switch q.Get("sort") {
	case "recent":
		order = "r.updated DESC, r.id DESC"
	case "rating":
		order = "r.rating IS NULL, r.rating DESC, r.name COLLATE NOCASE"
	}
	limit, offset := queryInt(r, "limit", 48, 200), queryInt(r, "offset", 0, 0)
	rows, err := s.db.QueryContext(ctx, `SELECT r.id,r.name,r.subtitle,r.photo,r.servings,
		CASE WHEN r.ready_minutes>0 THEN r.ready_minutes ELSE r.prep_minutes+r.cook_minutes END,
		r.types,r.rating,r.source FROM recipe r`+cond+` ORDER BY `+order+fmt.Sprintf(` LIMIT %d OFFSET %d`, limit, offset), args...)
	if err != nil {
		return nil, err
	}
	items := []*recipeSummary{}
	var ids []int64
	for rows.Next() {
		x := &recipeSummary{}
		if err := rows.Scan(&x.ID, &x.Name, &x.Subtitle, &x.Photo, &x.Servings, &x.Minutes, &x.Types, &x.Rating, &x.Source); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, x)
		ids = append(ids, x.ID)
	}
	rows.Close()
	nut, err := s.recipeNutrition(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, x := range items {
		if v, ok := nut[x.ID].PerServing["calories"]; ok {
			x.Calories = &v
		}
	}
	return map[string]any{"total": total, "items": items}, nil
}

// --- Recipe detail ----------------------------------------------------------

type ingredientLine struct {
	ID          int64    `json:"id"`
	IsHeading   bool     `json:"is_heading"`
	Quantity    string   `json:"quantity"`
	Unit        string   `json:"unit"`
	Text        string   `json:"text"`
	FoodID      *int64   `json:"food_id"`
	FoodName    string   `json:"food_name"`
	MeasureID   *int64   `json:"measure_id"`
	MeasureDesc string   `json:"measure_desc"`
	MeasureQty  *float64 `json:"measure_qty"`
	Grams       *float64 `json:"grams"`
}

type step struct {
	IsHeading bool   `json:"is_heading"`
	Text      string `json:"text"`
	Photo     string `json:"photo"`
}

type review struct {
	ID       int64  `json:"id"`
	Date     string `json:"date"`
	Rating   *int   `json:"rating"`
	Reviewer string `json:"reviewer"`
	Text     string `json:"text"`
}

type recipeDetail struct {
	ID            int64            `json:"id"`
	Name          string           `json:"name"`
	Subtitle      string           `json:"subtitle"`
	Servings      float64          `json:"servings"`
	Yield         string           `json:"yield"`
	ServingSize   string           `json:"serving_size"`
	Comments      string           `json:"comments"`
	PrepMinutes   int              `json:"prep_minutes"`
	CookMinutes   int              `json:"cook_minutes"`
	ReadyMinutes  int              `json:"ready_minutes"`
	Author        string           `json:"author"`
	Source        string           `json:"source"`
	Webpage       string           `json:"webpage"`
	Photo         string           `json:"photo"`
	SourcePhoto   string           `json:"source_photo"`
	Types         string           `json:"types"`
	Rating        *float64         `json:"rating"`
	NutritionMode string           `json:"nutrition_mode"`
	Created       string           `json:"created"`
	Updated       string           `json:"updated"`
	Ingredients   []ingredientLine `json:"ingredients"`
	Steps         []step           `json:"steps"`
	Notes         []string         `json:"notes"`
	Reviews       []review         `json:"reviews"`
	Groups        []recipeGroupRef `json:"groups"`
	Nutrition     *RecipeNutrition `json:"nutrition"`
}

type recipeGroupRef struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Cookbook string `json:"cookbook"`
}

func (s *srv) getRecipe(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	return s.loadRecipe(r.Context(), id)
}

func (s *srv) loadRecipe(ctx context.Context, id int64) (*recipeDetail, error) {
	d := &recipeDetail{Ingredients: []ingredientLine{}, Steps: []step{}, Notes: []string{}, Reviews: []review{}, Groups: []recipeGroupRef{}}
	err := s.db.QueryRowContext(ctx, `SELECT id,name,subtitle,servings,yield,serving_size,comments,prep_minutes,cook_minutes,ready_minutes,
		author,source,webpage,photo,source_photo,types,rating,nutrition_mode,created,updated FROM recipe WHERE id=?`, id).Scan(
		&d.ID, &d.Name, &d.Subtitle, &d.Servings, &d.Yield, &d.ServingSize, &d.Comments, &d.PrepMinutes, &d.CookMinutes, &d.ReadyMinutes,
		&d.Author, &d.Source, &d.Webpage, &d.Photo, &d.SourcePhoto, &d.Types, &d.Rating, &d.NutritionMode, &d.Created, &d.Updated)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `SELECT ri.id, ri.is_heading, ri.quantity, ri.unit, ri.text, ri.food_id, COALESCE(f.name,''),
		ri.measure_id, COALESCE(m.description,''), ri.measure_qty, fm.grams * ri.measure_qty
		FROM recipe_ingredient ri
		LEFT JOIN food f ON f.id=ri.food_id
		LEFT JOIN measure m ON m.id=ri.measure_id
		LEFT JOIN food_measure fm ON fm.food_id=ri.food_id AND fm.measure_id=ri.measure_id
		WHERE ri.recipe_id=? ORDER BY ri.idx, ri.id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var l ingredientLine
		if err := rows.Scan(&l.ID, &l.IsHeading, &l.Quantity, &l.Unit, &l.Text, &l.FoodID, &l.FoodName,
			&l.MeasureID, &l.MeasureDesc, &l.MeasureQty, &l.Grams); err != nil {
			rows.Close()
			return nil, err
		}
		d.Ingredients = append(d.Ingredients, l)
	}
	rows.Close()

	rows, err = s.db.QueryContext(ctx, `SELECT is_heading,text,photo FROM recipe_step WHERE recipe_id=? ORDER BY idx, id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var st step
		if err := rows.Scan(&st.IsHeading, &st.Text, &st.Photo); err != nil {
			rows.Close()
			return nil, err
		}
		d.Steps = append(d.Steps, st)
	}
	rows.Close()

	rows, err = s.db.QueryContext(ctx, `SELECT text FROM recipe_note WHERE recipe_id=? ORDER BY idx, id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			return nil, err
		}
		d.Notes = append(d.Notes, t)
	}
	rows.Close()

	rows, err = s.db.QueryContext(ctx, `SELECT id,date,rating,reviewer,text FROM recipe_review WHERE recipe_id=? ORDER BY date, id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var rv review
		if err := rows.Scan(&rv.ID, &rv.Date, &rv.Rating, &rv.Reviewer, &rv.Text); err != nil {
			rows.Close()
			return nil, err
		}
		d.Reviews = append(d.Reviews, rv)
	}
	rows.Close()

	rows, err = s.db.QueryContext(ctx, `SELECT g.id, g.name, COALESCE(c.name,'') FROM recipe_group_member m
		JOIN recipe_group g ON g.id=m.group_id LEFT JOIN cookbook c ON c.id=g.cookbook_id
		WHERE m.recipe_id=? ORDER BY c.name, g.name`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var g recipeGroupRef
		if err := rows.Scan(&g.ID, &g.Name, &g.Cookbook); err != nil {
			rows.Close()
			return nil, err
		}
		d.Groups = append(d.Groups, g)
	}
	rows.Close()

	nut, err := s.recipeNutrition(ctx, []int64{id})
	if err != nil {
		return nil, err
	}
	d.Nutrition = nut[id]
	return d, nil
}

// --- Create / update / delete -------------------------------------------------

type recipeInput struct {
	Name          string   `json:"name"`
	Subtitle      string   `json:"subtitle"`
	Servings      float64  `json:"servings"`
	Yield         string   `json:"yield"`
	ServingSize   string   `json:"serving_size"`
	Comments      string   `json:"comments"`
	PrepMinutes   int      `json:"prep_minutes"`
	CookMinutes   int      `json:"cook_minutes"`
	ReadyMinutes  int      `json:"ready_minutes"`
	Author        string   `json:"author"`
	Source        string   `json:"source"`
	Webpage       string   `json:"webpage"`
	Types         string   `json:"types"`
	Rating        *float64 `json:"rating"`
	NutritionMode string   `json:"nutrition_mode"`
	Ingredients   []struct {
		IsHeading  bool     `json:"is_heading"`
		Quantity   string   `json:"quantity"`
		Unit       string   `json:"unit"`
		Text       string   `json:"text"`
		FoodID     *int64   `json:"food_id"`
		MeasureID  *int64   `json:"measure_id"`
		MeasureQty *float64 `json:"measure_qty"`
	} `json:"ingredients"`
	Steps []struct {
		IsHeading bool   `json:"is_heading"`
		Text      string `json:"text"`
		Photo     string `json:"photo"`
	} `json:"steps"`
	Notes    []string `json:"notes"`
	GroupIDs []int64  `json:"group_ids"`
}

func (in *recipeInput) validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return badRequest("name is required")
	}
	if in.Servings <= 0 {
		in.Servings = 1
	}
	if in.NutritionMode != "label" {
		in.NutritionMode = "computed"
	}
	return nil
}

func (s *srv) createRecipe(r *http.Request) (any, error) {
	var in recipeInput
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	now := time.Now().Format("2006-01-02")
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO recipe(name,created,updated) VALUES(?,?,?)`, in.Name, now, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if err := saveRecipe(tx, id, &in); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.loadRecipe(r.Context(), id)
}

func (s *srv) updateRecipe(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var in recipeInput
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM recipe WHERE id=?`, id).Scan(&exists); err != nil {
		return nil, err
	}
	if err := saveRecipe(tx, id, &in); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.loadRecipe(r.Context(), id)
}

func saveRecipe(tx *sql.Tx, id int64, in *recipeInput) error {
	if _, err := tx.Exec(`UPDATE recipe SET name=?,subtitle=?,servings=?,yield=?,serving_size=?,comments=?,prep_minutes=?,cook_minutes=?,
		ready_minutes=?,author=?,source=?,webpage=?,types=?,rating=?,nutrition_mode=?,updated=? WHERE id=?`,
		in.Name, in.Subtitle, in.Servings, in.Yield, in.ServingSize, in.Comments, in.PrepMinutes, in.CookMinutes, in.ReadyMinutes,
		in.Author, in.Source, in.Webpage, in.Types, in.Rating, in.NutritionMode, time.Now().Format("2006-01-02"), id); err != nil {
		return err
	}
	for _, t := range []string{"recipe_ingredient", "recipe_step", "recipe_note", "recipe_group_member"} {
		if _, err := tx.Exec(`DELETE FROM `+t+` WHERE recipe_id=?`, id); err != nil {
			return err
		}
	}
	for i, ing := range in.Ingredients {
		if strings.TrimSpace(ing.Text) == "" && ing.FoodID == nil {
			continue
		}
		if ing.IsHeading {
			ing.FoodID, ing.MeasureID, ing.MeasureQty = nil, nil, nil
		}
		if _, err := tx.Exec(`INSERT INTO recipe_ingredient(recipe_id,idx,is_heading,quantity,unit,text,food_id,measure_id,measure_qty)
			VALUES(?,?,?,?,?,?,?,?,?)`, id, i+1, ing.IsHeading, strings.TrimSpace(ing.Quantity), strings.TrimSpace(ing.Unit),
			strings.TrimSpace(ing.Text), ing.FoodID, ing.MeasureID, ing.MeasureQty); err != nil {
			return err
		}
	}
	for i, st := range in.Steps {
		if strings.TrimSpace(st.Text) == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO recipe_step(recipe_id,idx,is_heading,text,photo) VALUES(?,?,?,?,?)`,
			id, i+1, st.IsHeading, strings.TrimSpace(st.Text), st.Photo); err != nil {
			return err
		}
	}
	for i, n := range in.Notes {
		if strings.TrimSpace(n) == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO recipe_note(recipe_id,idx,text) VALUES(?,?,?)`, id, i+1, strings.TrimSpace(n)); err != nil {
			return err
		}
	}
	for _, g := range in.GroupIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO recipe_group_member(group_id,recipe_id) VALUES(?,?)`, g, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *srv) deleteRecipe(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var used int
	if err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM diary_entry WHERE recipe_id=?`, id).Scan(&used); err != nil {
		return nil, err
	}
	if used > 0 {
		return nil, errStatus(http.StatusConflict, "this recipe is used in %d diary entries; remove those first", used)
	}
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM recipe WHERE id=?`, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, sql.ErrNoRows
	}
	return nil, nil
}

var photoTypes = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}

// uploadRecipePhoto accepts the raw image as the request body.
func (s *srv) uploadRecipePhoto(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 10<<20))
	if err != nil {
		return nil, badRequest("photo too large (10 MB max)")
	}
	mime := http.DetectContentType(data)
	ext, ok := photoTypes[mime]
	if !ok {
		return nil, badRequest("unsupported image type %s", mime)
	}
	name := fmt.Sprintf("recipe-%d-%d%s", id, time.Now().UnixNano(), ext)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var old string
	if err := tx.QueryRow(`SELECT photo FROM recipe WHERE id=?`, id).Scan(&old); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO media(name,mime,data) VALUES(?,?,?)`, name, mime, data); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE recipe SET photo=? WHERE id=?`, name, id); err != nil {
		return nil, err
	}
	if err := deleteUploadedMedia(tx, old); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]string{"photo": name}, nil
}

func (s *srv) deleteRecipePhoto(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var old string
	if err := tx.QueryRow(`SELECT photo FROM recipe WHERE id=?`, id).Scan(&old); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE recipe SET photo='' WHERE id=?`, id); err != nil {
		return nil, err
	}
	if err := deleteUploadedMedia(tx, old); err != nil {
		return nil, err
	}
	return nil, tx.Commit()
}

// deleteUploadedMedia removes a photo uploaded through the app. Imported
// legacy images are left alone because other records may share them.
func deleteUploadedMedia(tx *sql.Tx, name string) error {
	if !strings.HasPrefix(name, "recipe-") || filepath.Base(name) != name {
		return nil
	}
	_, err := tx.Exec(`DELETE FROM media WHERE name=?`, name)
	return err
}
