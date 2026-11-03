package server

import (
	"context"
	"math"

	"dietpro/internal/store"
)

// Nutr maps nutrient keys to amounts.
type Nutr map[string]float64

// addScaled adds b*f into n. A missing key in b is treated as unknown, not zero.
func (n Nutr) addScaled(b Nutr, f float64) {
	for k, v := range b {
		n[k] += v * f
	}
}

func (n Nutr) rounded() Nutr {
	out := make(Nutr, len(n))
	for k, v := range n {
		out[k] = math.Round(v*1000) / 1000
	}
	return out
}

func (s *srv) nutrientDefs(ctx context.Context) ([]store.Nutrient, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key,name,unit,category,daily_value FROM nutrient ORDER BY sort`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.Nutrient
	for rows.Next() {
		var n store.Nutrient
		if err := rows.Scan(&n.Key, &n.Name, &n.Unit, &n.Category, &n.DailyValue); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// foodNutrients loads per-100 g nutrient values for the given foods.
func (s *srv) foodNutrients(ctx context.Context, ids []int64) (map[int64]Nutr, error) {
	out := map[int64]Nutr{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT food_id,nutrient,amount FROM food_nutrient WHERE food_id IN (`+placeholders(len(ids))+`)`, int64Args(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var k string
		var v float64
		if err := rows.Scan(&id, &k, &v); err != nil {
			return nil, err
		}
		if out[id] == nil {
			out[id] = Nutr{}
		}
		out[id][k] = v
	}
	return out, rows.Err()
}

// RecipeNutrition is a recipe's nutrition for one serving.
type RecipeNutrition struct {
	Mode       string `json:"mode"` // "computed" or "label"
	HasLabel   bool   `json:"has_label"`
	PerServing Nutr   `json:"per_serving"`
	// Grams of one serving when computed from ingredients.
	ServingGrams float64 `json:"serving_grams"`
	// Ingredient lines that could not be included in the calculation.
	Missing []string `json:"missing"`
}

// recipeNutrition computes per-serving nutrition for each recipe. Recipes in
// "label" mode use the stored label values; others sum their ingredients.
func (s *srv) recipeNutrition(ctx context.Context, ids []int64) (map[int64]*RecipeNutrition, error) {
	out := map[int64]*RecipeNutrition{}
	if len(ids) == 0 {
		return out, nil
	}
	in, args := placeholders(len(ids)), int64Args(ids)

	servings := map[int64]float64{}
	rows, err := s.db.QueryContext(ctx, `SELECT r.id, r.servings, r.nutrition_mode,
		EXISTS(SELECT 1 FROM recipe_label_nutrient l WHERE l.recipe_id=r.id)
		FROM recipe r WHERE r.id IN (`+in+`)`, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var sv float64
		rn := &RecipeNutrition{PerServing: Nutr{}, Missing: []string{}}
		if err := rows.Scan(&id, &sv, &rn.Mode, &rn.HasLabel); err != nil {
			rows.Close()
			return nil, err
		}
		if rn.Mode == "label" && !rn.HasLabel {
			rn.Mode = "computed"
		}
		if sv <= 0 {
			sv = 1
		}
		servings[id] = sv
		out[id] = rn
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Label values.
	rows, err = s.db.QueryContext(ctx, `SELECT recipe_id,nutrient,amount FROM recipe_label_nutrient WHERE recipe_id IN (`+in+`)`, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var k string
		var v float64
		if err := rows.Scan(&id, &k, &v); err != nil {
			rows.Close()
			return nil, err
		}
		if rn := out[id]; rn != nil && rn.Mode == "label" {
			rn.PerServing[k] = v
		}
	}
	rows.Close()

	// Ingredient-derived values (also used for serving weight in label mode).
	type line struct {
		recipe int64
		text   string
		food   *int64
		grams  *float64
	}
	var lines []line
	foodSet := map[int64]bool{}
	rows, err = s.db.QueryContext(ctx, `SELECT ri.recipe_id, ri.text, ri.food_id, fm.grams * COALESCE(ri.measure_qty,0)
		FROM recipe_ingredient ri
		LEFT JOIN food_measure fm ON fm.food_id=ri.food_id AND fm.measure_id=ri.measure_id
		WHERE ri.is_heading=0 AND ri.recipe_id IN (`+in+`) ORDER BY ri.recipe_id, ri.idx`, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.recipe, &l.text, &l.food, &l.grams); err != nil {
			rows.Close()
			return nil, err
		}
		lines = append(lines, l)
		if l.food != nil {
			foodSet[*l.food] = true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	foodIDs := make([]int64, 0, len(foodSet))
	for id := range foodSet {
		foodIDs = append(foodIDs, id)
	}
	fn, err := s.foodNutrients(ctx, foodIDs)
	if err != nil {
		return nil, err
	}
	totals := map[int64]Nutr{}
	grams := map[int64]float64{}
	for _, l := range lines {
		rn := out[l.recipe]
		if l.food == nil || l.grams == nil {
			if l.text != "" {
				rn.Missing = append(rn.Missing, l.text)
			}
			continue
		}
		grams[l.recipe] += *l.grams
		if totals[l.recipe] == nil {
			totals[l.recipe] = Nutr{}
		}
		totals[l.recipe].addScaled(fn[*l.food], *l.grams/100)
	}
	for id, rn := range out {
		rn.ServingGrams = math.Round(grams[id]/servings[id]*10) / 10
		if rn.Mode == "computed" {
			rn.PerServing.addScaled(totals[id], 1/servings[id])
		}
		rn.PerServing = rn.PerServing.rounded()
	}
	return out, nil
}
