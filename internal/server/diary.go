package server

import (
	"context"
	"database/sql"
	"math"
	"net/http"
	"strings"
	"time"
)

// --- Profiles -----------------------------------------------------------------

type profile struct {
	ID             int64    `json:"id"`
	Name           string   `json:"name"`
	Gender         string   `json:"gender"`
	Age            *int     `json:"age"`
	HeightCm       *float64 `json:"height_cm"`
	StartDate      string   `json:"start_date"`
	EndDate        string   `json:"end_date"`
	StartWeightKg  *float64 `json:"start_weight_kg"`
	GoalWeightKg   *float64 `json:"goal_weight_kg"`
	WeeklyChangeKg float64  `json:"weekly_change_kg"`
	ActivityFactor float64  `json:"activity_factor"`
	BudgetMode     string   `json:"budget_mode"`
	CalorieBudget  *float64 `json:"calorie_budget"`
	Comments       string   `json:"comments"`

	// Derived, read-only.
	LatestWeightKg *float64 `json:"latest_weight_kg"`
	BMR            *float64 `json:"bmr"`
	Maintenance    *float64 `json:"maintenance"`
	Budget         *float64 `json:"budget"`
}

const profileCols = `id,name,gender,age,height_cm,start_date,end_date,start_weight_kg,goal_weight_kg,weekly_change_kg,
	activity_factor,budget_mode,calorie_budget,comments`

func scanProfile(sc interface{ Scan(...any) error }) (*profile, error) {
	p := &profile{}
	err := sc.Scan(&p.ID, &p.Name, &p.Gender, &p.Age, &p.HeightCm, &p.StartDate, &p.EndDate, &p.StartWeightKg, &p.GoalWeightKg,
		&p.WeeklyChangeKg, &p.ActivityFactor, &p.BudgetMode, &p.CalorieBudget, &p.Comments)
	return p, err
}

// loadProfile loads a profile with its derived budget as of date (YYYY-MM-DD).
func (s *srv) loadProfile(ctx context.Context, id int64, date string) (*profile, error) {
	p, err := scanProfile(s.db.QueryRowContext(ctx, `SELECT `+profileCols+` FROM profile WHERE id=?`, id))
	if err != nil {
		return nil, err
	}
	var w float64
	err = s.db.QueryRowContext(ctx, `SELECT weight_kg FROM weight_log WHERE profile_id=? AND date<=? ORDER BY date DESC LIMIT 1`, id, date).Scan(&w)
	switch {
	case err == nil:
		p.LatestWeightKg = &w
	case err == sql.ErrNoRows:
		p.LatestWeightKg = p.StartWeightKg
	default:
		return nil, err
	}
	p.derive()
	return p, nil
}

// derive computes BMR (Mifflin-St Jeor), maintenance and the daily calorie budget.
func (p *profile) derive() {
	if p.LatestWeightKg != nil && p.HeightCm != nil && p.Age != nil {
		bmr := 10**p.LatestWeightKg + 6.25**p.HeightCm - 5*float64(*p.Age)
		if strings.EqualFold(p.Gender, "male") {
			bmr += 5
		} else {
			bmr -= 161
		}
		factor := p.ActivityFactor
		if factor <= 0 {
			factor = 1.2
		}
		maint := bmr * factor
		bmr, maint = math.Round(bmr), math.Round(maint)
		p.BMR, p.Maintenance = &bmr, &maint
	}
	if p.BudgetMode == "automatic" && p.Maintenance != nil {
		// ~7,700 kcal per kg of body weight.
		b := math.Round(*p.Maintenance + p.WeeklyChangeKg*7700/7)
		p.Budget = &b
	} else {
		p.Budget = p.CalorieBudget
	}
}

func today() string { return time.Now().Format("2006-01-02") }

func (s *srv) listProfiles(r *http.Request) (any, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id FROM profile ORDER BY name`)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	out := []*profile{}
	for _, id := range ids {
		p, err := s.loadProfile(r.Context(), id, today())
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *srv) getProfile(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	return s.loadProfile(r.Context(), id, today())
}

func (in *profile) validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return badRequest("name is required")
	}
	if in.BudgetMode != "automatic" {
		in.BudgetMode = "manual"
	}
	if in.ActivityFactor <= 0 {
		in.ActivityFactor = 1.2
	}
	return nil
}

func (s *srv) createProfile(r *http.Request) (any, error) {
	var in profile
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	if in.StartDate == "" {
		in.StartDate = today()
	}
	res, err := s.db.ExecContext(r.Context(), `INSERT INTO profile(name,gender,age,height_cm,start_date,end_date,start_weight_kg,goal_weight_kg,
		weekly_change_kg,activity_factor,budget_mode,calorie_budget,comments) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		in.Name, in.Gender, in.Age, in.HeightCm, in.StartDate, in.EndDate, in.StartWeightKg, in.GoalWeightKg,
		in.WeeklyChangeKg, in.ActivityFactor, in.BudgetMode, in.CalorieBudget, in.Comments)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.loadProfile(r.Context(), id, today())
}

func (s *srv) updateProfile(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var in profile
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	res, err := s.db.ExecContext(r.Context(), `UPDATE profile SET name=?,gender=?,age=?,height_cm=?,start_date=?,end_date=?,start_weight_kg=?,
		goal_weight_kg=?,weekly_change_kg=?,activity_factor=?,budget_mode=?,calorie_budget=?,comments=? WHERE id=?`,
		in.Name, in.Gender, in.Age, in.HeightCm, in.StartDate, in.EndDate, in.StartWeightKg, in.GoalWeightKg,
		in.WeeklyChangeKg, in.ActivityFactor, in.BudgetMode, in.CalorieBudget, in.Comments, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, sql.ErrNoRows
	}
	return s.loadProfile(r.Context(), id, today())
}

func (s *srv) deleteProfile(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM profile WHERE id=?`, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, sql.ErrNoRows
	}
	return nil, nil
}

// --- Diary --------------------------------------------------------------------

type dayEntry struct {
	ID          int64    `json:"id"`
	Date        string   `json:"date"`
	MealID      int64    `json:"meal_id"`
	Kind        string   `json:"kind"`
	Name        string   `json:"name"`
	FoodID      *int64   `json:"food_id"`
	RecipeID    *int64   `json:"recipe_id"`
	MeasureID   *int64   `json:"measure_id"`
	MeasureDesc string   `json:"measure_desc"`
	MeasureQty  *float64 `json:"measure_qty"`
	Servings    *float64 `json:"servings"`
	Grams       *float64 `json:"grams"`
	Nutrients   Nutr     `json:"nutrients"`
}

type activityEntry struct {
	ID         int64   `json:"id"`
	ActivityID int64   `json:"activity_id"`
	Name       string  `json:"name"`
	Minutes    float64 `json:"minutes"`
	Calories   float64 `json:"calories"`
	Comments   string  `json:"comments"`
}

type day struct {
	Date       string          `json:"date"`
	Profile    *profile        `json:"profile"`
	Entries    []*dayEntry     `json:"entries"`
	Activities []activityEntry `json:"activities"`
	Totals     Nutr            `json:"totals"`
	Burned     float64         `json:"burned"`
	WeightKg   *float64        `json:"weight_kg"` // logged on this exact date
	Note       string          `json:"note"`
}

// loadEntries returns diary entries for a profile between from and to inclusive,
// with nutrition filled in.
func (s *srv) loadEntries(ctx context.Context, profileID int64, from, to string) ([]*dayEntry, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id, e.date, e.meal_id, e.kind,
		CASE e.kind WHEN 'food' THEN COALESCE(f.name, e.text) WHEN 'recipe' THEN COALESCE(r.name, e.text) ELSE e.text END,
		e.food_id, e.recipe_id, e.measure_id, COALESCE(m.description,''), e.measure_qty, e.servings,
		fm.grams * e.measure_qty
		FROM diary_entry e
		LEFT JOIN food f ON f.id=e.food_id
		LEFT JOIN recipe r ON r.id=e.recipe_id
		LEFT JOIN measure m ON m.id=e.measure_id
		LEFT JOIN food_measure fm ON fm.food_id=e.food_id AND fm.measure_id=e.measure_id
		WHERE e.profile_id=? AND e.date BETWEEN ? AND ? ORDER BY e.date, e.meal_id, e.idx, e.id`, profileID, from, to)
	if err != nil {
		return nil, err
	}
	var out []*dayEntry
	foods, recipes := map[int64]bool{}, map[int64]bool{}
	for rows.Next() {
		e := &dayEntry{Nutrients: Nutr{}}
		if err := rows.Scan(&e.ID, &e.Date, &e.MealID, &e.Kind, &e.Name, &e.FoodID, &e.RecipeID, &e.MeasureID, &e.MeasureDesc,
			&e.MeasureQty, &e.Servings, &e.Grams); err != nil {
			rows.Close()
			return nil, err
		}
		if e.Kind == "food" && e.FoodID != nil {
			foods[*e.FoodID] = true
		}
		if e.Kind == "recipe" && e.RecipeID != nil {
			recipes[*e.RecipeID] = true
		}
		out = append(out, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	fn, err := s.foodNutrients(ctx, keys(foods))
	if err != nil {
		return nil, err
	}
	rn, err := s.recipeNutrition(ctx, keys(recipes))
	if err != nil {
		return nil, err
	}
	for _, e := range out {
		switch {
		case e.Kind == "food" && e.FoodID != nil && e.Grams != nil:
			e.Nutrients.addScaled(fn[*e.FoodID], *e.Grams/100)
		case e.Kind == "recipe" && e.RecipeID != nil && rn[*e.RecipeID] != nil:
			sv := 1.0
			if e.Servings != nil {
				sv = *e.Servings
			}
			e.Nutrients.addScaled(rn[*e.RecipeID].PerServing, sv)
		}
		e.Nutrients = e.Nutrients.rounded()
	}
	return out, nil
}

func keys(m map[int64]bool) []int64 {
	out := make([]int64, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func (s *srv) getDay(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	date, err := pathDate(r)
	if err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), id, date)
}

func (s *srv) loadDay(ctx context.Context, id int64, date string) (*day, error) {
	p, err := s.loadProfile(ctx, id, date)
	if err != nil {
		return nil, err
	}
	d := &day{Date: date, Profile: p, Totals: Nutr{}, Activities: []activityEntry{}}
	if d.Entries, err = s.loadEntries(ctx, id, date, date); err != nil {
		return nil, err
	}
	if d.Entries == nil {
		d.Entries = []*dayEntry{}
	}
	for _, e := range d.Entries {
		d.Totals.addScaled(e.Nutrients, 1)
	}
	d.Totals = d.Totals.rounded()

	rows, err := s.db.QueryContext(ctx, `SELECT l.id, l.activity_id, COALESCE(a.name,'Activity'), l.minutes, l.calories, l.comments
		FROM activity_log l LEFT JOIN activity a ON a.id=l.activity_id WHERE l.profile_id=? AND l.date=? ORDER BY l.id`, id, date)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var a activityEntry
		if err := rows.Scan(&a.ID, &a.ActivityID, &a.Name, &a.Minutes, &a.Calories, &a.Comments); err != nil {
			rows.Close()
			return nil, err
		}
		d.Activities = append(d.Activities, a)
		d.Burned += a.Calories
	}
	rows.Close()

	var w float64
	if err := s.db.QueryRowContext(ctx, `SELECT weight_kg FROM weight_log WHERE profile_id=? AND date=?`, id, date).Scan(&w); err == nil {
		d.WeightKg = &w
	}
	s.db.QueryRowContext(ctx, `SELECT text FROM day_note WHERE profile_id=? AND date=?`, id, date).Scan(&d.Note)
	return d, nil
}

type entryInput struct {
	MealID     int64    `json:"meal_id"`
	Kind       string   `json:"kind"`
	FoodID     *int64   `json:"food_id"`
	MeasureID  *int64   `json:"measure_id"`
	MeasureQty *float64 `json:"measure_qty"`
	RecipeID   *int64   `json:"recipe_id"`
	Servings   *float64 `json:"servings"`
	Text       string   `json:"text"`
}

func (in *entryInput) validate() error {
	if in.MealID == 0 {
		return badRequest("meal_id is required")
	}
	switch in.Kind {
	case "food":
		if in.FoodID == nil || in.MeasureID == nil || in.MeasureQty == nil || *in.MeasureQty < 0 {
			return badRequest("food entries need food_id, measure_id and a non-negative measure_qty")
		}
		in.RecipeID, in.Servings = nil, nil
	case "recipe":
		if in.RecipeID == nil || in.Servings == nil || *in.Servings < 0 {
			return badRequest("recipe entries need recipe_id and non-negative servings")
		}
		in.FoodID, in.MeasureID, in.MeasureQty = nil, nil, nil
	case "text":
		if strings.TrimSpace(in.Text) == "" {
			return badRequest("text entries need text")
		}
	default:
		return badRequest("kind must be food, recipe or text")
	}
	return nil
}

func (s *srv) addEntry(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	date, err := pathDate(r)
	if err != nil {
		return nil, err
	}
	var in entryInput
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO diary_entry(profile_id,date,meal_id,idx,kind,food_id,measure_id,measure_qty,recipe_id,servings,text)
		VALUES(?1,?2,?3,(SELECT COALESCE(max(idx),0)+1 FROM diary_entry WHERE profile_id=?1 AND date=?2 AND meal_id=?3),?4,?5,?6,?7,?8,?9,?10)`,
		id, date, in.MealID, in.Kind, in.FoodID, in.MeasureID, in.MeasureQty, in.RecipeID, in.Servings, in.Text); err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), id, date)
}

func (s *srv) updateEntry(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var in entryInput
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := in.validate(); err != nil {
		return nil, err
	}
	var profileID int64
	var date string
	if err := s.db.QueryRowContext(r.Context(), `SELECT profile_id,date FROM diary_entry WHERE id=?`, id).Scan(&profileID, &date); err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE diary_entry SET meal_id=?,kind=?,food_id=?,measure_id=?,measure_qty=?,recipe_id=?,servings=?,text=? WHERE id=?`,
		in.MealID, in.Kind, in.FoodID, in.MeasureID, in.MeasureQty, in.RecipeID, in.Servings, in.Text, id); err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), profileID, date)
}

func (s *srv) deleteEntry(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var profileID int64
	var date string
	if err := s.db.QueryRowContext(r.Context(), `SELECT profile_id,date FROM diary_entry WHERE id=?`, id).Scan(&profileID, &date); err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(r.Context(), `DELETE FROM diary_entry WHERE id=?`, id); err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), profileID, date)
}

func (s *srv) setWeight(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	date, err := pathDate(r)
	if err != nil {
		return nil, err
	}
	var in struct {
		WeightKg *float64 `json:"weight_kg"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if in.WeightKg == nil || *in.WeightKg <= 0 {
		_, err = s.db.ExecContext(r.Context(), `DELETE FROM weight_log WHERE profile_id=? AND date=?`, id, date)
	} else {
		_, err = s.db.ExecContext(r.Context(), `INSERT INTO weight_log(profile_id,date,weight_kg) VALUES(?,?,?)
			ON CONFLICT(profile_id,date) DO UPDATE SET weight_kg=excluded.weight_kg`, id, date, *in.WeightKg)
	}
	if err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), id, date)
}

func (s *srv) setNote(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	date, err := pathDate(r)
	if err != nil {
		return nil, err
	}
	var in struct {
		Text string `json:"text"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Text) == "" {
		_, err = s.db.ExecContext(r.Context(), `DELETE FROM day_note WHERE profile_id=? AND date=?`, id, date)
	} else {
		_, err = s.db.ExecContext(r.Context(), `INSERT INTO day_note(profile_id,date,text) VALUES(?,?,?)
			ON CONFLICT(profile_id,date) DO UPDATE SET text=excluded.text`, id, date, in.Text)
	}
	if err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), id, date)
}

// --- Activities -----------------------------------------------------------------

type activity struct {
	ID              int64   `json:"id"`
	Name            string  `json:"name"`
	Group           string  `json:"group"`
	KcalPerLbMinute float64 `json:"kcal_per_lb_minute"`
}

func (s *srv) listActivities(r *http.Request) (any, error) {
	var where []string
	var args []any
	for _, t := range likeTokens(r.URL.Query().Get("q")) {
		where = append(where, `(lower(a.name) LIKE ? ESCAPE '\' OR lower(COALESCE(g.name,'')) LIKE ? ESCAPE '\')`)
		args = append(args, t, t)
	}
	cond := ""
	if len(where) > 0 {
		cond = " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT a.id, a.name, COALESCE(g.name,''), a.kcal_per_lb_minute
		FROM activity a LEFT JOIN activity_group g ON g.id=a.group_id`+cond+` ORDER BY a.name LIMIT 60`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activity{}
	for rows.Next() {
		var a activity
		if err := rows.Scan(&a.ID, &a.Name, &a.Group, &a.KcalPerLbMinute); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *srv) addActivity(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	date, err := pathDate(r)
	if err != nil {
		return nil, err
	}
	var in struct {
		ActivityID int64    `json:"activity_id"`
		Minutes    float64  `json:"minutes"`
		Calories   *float64 `json:"calories"`
		Comments   string   `json:"comments"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if in.ActivityID == 0 || in.Minutes <= 0 {
		return nil, badRequest("activity_id and positive minutes are required")
	}
	if in.Calories == nil {
		var rate float64
		if err := s.db.QueryRowContext(r.Context(), `SELECT kcal_per_lb_minute FROM activity WHERE id=?`, in.ActivityID).Scan(&rate); err != nil {
			return nil, err
		}
		p, err := s.loadProfile(r.Context(), id, date)
		if err != nil {
			return nil, err
		}
		if p.LatestWeightKg == nil {
			return nil, badRequest("record a weight for this profile, or enter calories burned manually")
		}
		c := math.Round(rate * *p.LatestWeightKg * 2.20462 * in.Minutes)
		in.Calories = &c
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO activity_log(profile_id,date,activity_id,minutes,calories,comments) VALUES(?,?,?,?,?,?)`,
		id, date, in.ActivityID, in.Minutes, *in.Calories, in.Comments); err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), id, date)
}

func (s *srv) deleteActivityLog(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	var profileID int64
	var date string
	if err := s.db.QueryRowContext(r.Context(), `SELECT profile_id,date FROM activity_log WHERE id=?`, id).Scan(&profileID, &date); err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(r.Context(), `DELETE FROM activity_log WHERE id=?`, id); err != nil {
		return nil, err
	}
	return s.loadDay(r.Context(), profileID, date)
}

// --- Trends -------------------------------------------------------------------------

type summaryDay struct {
	Date     string   `json:"date"`
	Calories *float64 `json:"calories"`
	Burned   float64  `json:"burned"`
	WeightKg *float64 `json:"weight_kg"`
}

// profileSummary returns daily calories, exercise and weight for a date range
// (?days=N ending at ?end=YYYY-MM-DD, default today).
func (s *srv) profileSummary(r *http.Request) (any, error) {
	id, err := pathID(r, "id")
	if err != nil {
		return nil, err
	}
	end := r.URL.Query().Get("end")
	endT, err := time.Parse("2006-01-02", end)
	if err != nil {
		endT, _ = time.Parse("2006-01-02", today())
	}
	days := queryInt(r, "days", 30, 366)
	if days == 0 {
		days = 30
	}
	startT := endT.AddDate(0, 0, -(days - 1))
	from, to := startT.Format("2006-01-02"), endT.Format("2006-01-02")

	ctx := r.Context()
	byDate := map[string]*summaryDay{}
	out := make([]*summaryDay, 0, days)
	for t := startT; !t.After(endT); t = t.AddDate(0, 0, 1) {
		d := &summaryDay{Date: t.Format("2006-01-02")}
		byDate[d.Date] = d
		out = append(out, d)
	}
	entries, err := s.loadEntries(ctx, id, from, to)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		d := byDate[e.Date]
		if d.Calories == nil {
			d.Calories = new(float64)
		}
		*d.Calories += e.Nutrients["calories"]
	}
	rows, err := s.db.QueryContext(ctx, `SELECT date, sum(calories) FROM activity_log WHERE profile_id=? AND date BETWEEN ? AND ? GROUP BY date`, id, from, to)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var date string
		var c float64
		if err := rows.Scan(&date, &c); err != nil {
			rows.Close()
			return nil, err
		}
		byDate[date].Burned = c
	}
	rows.Close()
	rows, err = s.db.QueryContext(ctx, `SELECT date, weight_kg FROM weight_log WHERE profile_id=? AND date BETWEEN ? AND ?`, id, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		var w float64
		if err := rows.Scan(&date, &w); err != nil {
			return nil, err
		}
		byDate[date].WeightKg = &w
	}
	for _, d := range out {
		if d.Calories != nil {
			v := math.Round(*d.Calories)
			d.Calories = &v
		}
	}
	return out, rows.Err()
}
