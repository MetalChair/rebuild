package server

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"testing/fstest"

	"dietpro/internal/importer"
	"dietpro/internal/store"
)

// legacyDir points at the original Diet Pro export, which lives outside this
// module. Tests that need it are skipped when it is absent.
var legacyDir = filepath.Join("..", "..", "..", "DIETPRO_RECOVERY", "DietProExport")

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	if _, err := os.Stat(legacyDir); err != nil {
		t.Skip("legacy CSV export not available")
	}
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := importer.Run(db, importer.Options{CSVDir: legacyDir}); err != nil {
		t.Fatal(err)
	}
	return New(db, fstest.MapFS{"index.html": {Data: []byte("ok")}})
}

func do(t *testing.T, h http.Handler, method, path string, body any, out any) int {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, &buf))
	if out != nil && rec.Code < 300 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("%s %s: decode: %v (%s)", method, path, err, rec.Body.String())
		}
	}
	return rec.Code
}

func near(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// Legacy Diet Pro stored 322.73 kcal/serving for this recipe, computed from
// its ingredients; our calculation must agree.
func TestRecipeNutritionMatchesLegacy(t *testing.T) {
	h := newTestServer(t)
	var r recipeDetail
	if code := do(t, h, "GET", "/api/recipes/265", nil, &r); code != 200 {
		t.Fatalf("status %d", code)
	}
	if r.Nutrition.Mode != "computed" {
		t.Fatalf("mode = %s", r.Nutrition.Mode)
	}
	checks := map[string]float64{"calories": 322.73, "totalfat": 11.74, "protein": 28.71, "sodium": 1080.58}
	for k, want := range checks {
		if got := r.Nutrition.PerServing[k]; !near(got, want, 0.02) {
			t.Errorf("%s = %.3f, want %.2f", k, got, want)
		}
	}

	// Recipe 266 uses published label values.
	if do(t, h, "GET", "/api/recipes/266", nil, &r); r.Nutrition.Mode != "label" || r.Nutrition.PerServing["calories"] != 510 {
		t.Errorf("label recipe: mode=%s calories=%v", r.Nutrition.Mode, r.Nutrition.PerServing["calories"])
	}
}

func TestDiaryRoundTrip(t *testing.T) {
	h := newTestServer(t)
	var d day
	do(t, h, "GET", "/api/profiles/2/diary/2005-04-30", nil, &d)
	// Legacy t_calendarday stored 1293.58 kcal for this day.
	if !near(d.Totals["calories"], 1293.58, 1) {
		t.Errorf("day calories = %.2f, want ~1293.58", d.Totals["calories"])
	}

	date := "/api/profiles/2/diary/2030-01-01"
	foodID, measure, qty := int64(1001), int64(21000), 2.0 // 2 tbsp butter
	if code := do(t, h, "POST", date+"/entries", entryInput{MealID: 1, Kind: "food", FoodID: &foodID, MeasureID: &measure, MeasureQty: &qty}, &d); code != 200 {
		t.Fatalf("add entry: %d", code)
	}
	if len(d.Entries) != 1 || !near(d.Totals["calories"], 717*28.4/100, 0.01) {
		t.Fatalf("after add: %d entries, %.2f kcal", len(d.Entries), d.Totals["calories"])
	}
	do(t, h, "PUT", date+"/weight", map[string]float64{"weight_kg": 70}, &d)
	if code := do(t, h, "POST", date+"/activities", map[string]any{"activity_id": 5, "minutes": 30}, &d); code != 200 {
		t.Fatalf("add activity: %d", code)
	}
	if d.Burned <= 0 {
		t.Errorf("burned = %v", d.Burned)
	}
	if code := do(t, h, "DELETE", "/api/entries/"+itoa(d.Entries[0].ID), nil, &d); code != 200 || len(d.Entries) != 0 {
		t.Errorf("delete entry: code %d, %d entries left", code, len(d.Entries))
	}
}

func TestRecipeAndFoodCRUD(t *testing.T) {
	h := newTestServer(t)
	var f foodDetail
	cal := 250.0
	in := map[string]any{"name": "Test bar", "nutrients": map[string]any{"calories": cal}, "measures": []map[string]any{{"description": "1 bar", "grams": 40}}}
	if code := do(t, h, "POST", "/api/foods", in, &f); code != 200 || f.ID < firstUserFoodID {
		t.Fatalf("create food: code %d id %d", code, f.ID)
	}
	var barMeasure int64
	for _, m := range f.Measures {
		if m.Description == "1 bar" {
			barMeasure = m.ID
		}
	}
	var r recipeDetail
	recipe := map[string]any{
		"name": "Two bars", "servings": 2,
		"ingredients": []map[string]any{{"quantity": "2", "text": "bars", "food_id": f.ID, "measure_id": barMeasure, "measure_qty": 2}},
		"steps":       []map[string]any{{"text": "Unwrap."}},
	}
	if code := do(t, h, "POST", "/api/recipes", recipe, &r); code != 200 {
		t.Fatalf("create recipe: %d", code)
	}
	if got := r.Nutrition.PerServing["calories"]; !near(got, 100, 0.001) { // 2 bars × 40 g × 2.5 kcal/g ÷ 2 servings
		t.Errorf("per-serving calories = %v, want 100", got)
	}
	if code := do(t, h, "DELETE", "/api/foods/"+itoa(f.ID), nil, nil); code != http.StatusConflict {
		t.Errorf("deleting a food in use: got %d, want 409", code)
	}
	if code := do(t, h, "DELETE", "/api/recipes/"+itoa(r.ID), nil, nil); code != http.StatusNoContent {
		t.Errorf("delete recipe: %d", code)
	}
	if code := do(t, h, "DELETE", "/api/foods/"+itoa(f.ID), nil, nil); code != http.StatusNoContent {
		t.Errorf("delete food: %d", code)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
