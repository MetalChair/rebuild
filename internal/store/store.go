// Package store owns the SQLite schema and the nutrient catalogue.
package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"net/url"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

// GramMeasureID is the "1 gram" measure. Every food gets a row for it so any
// food can be logged by weight.
const GramMeasureID = 99998

// Open opens (creating if necessary) the database at path and applies the schema.
func Open(path string) (*sql.DB, error) {
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "synchronous(NORMAL)")
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := seedNutrients(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// Nutrient describes one tracked nutrient. Key matches the legacy Diet Pro
// column name so the importer can map columns generically.
type Nutrient struct {
	Key        string   `json:"key"`
	Name       string   `json:"name"`
	Unit       string   `json:"unit"`
	Category   string   `json:"category"`
	DailyValue *float64 `json:"daily_value"`
}

func dv(v float64) *float64 { return &v }

// Nutrients is the catalogue in display order. Daily values follow the FDA
// 2,000 kcal reference; vitamins A and D keep IU because the USDA SR data is in IU.
var Nutrients = []Nutrient{
	{"calories", "Calories", "kcal", "energy", dv(2000)},
	{"energy", "Energy", "kJ", "energy", nil},
	{"caloriesfromfat", "Calories from fat", "kcal", "energy", nil},
	{"caloriesfromcarbs", "Calories from carbs", "kcal", "energy", nil},
	{"caloriesfromprotein", "Calories from protein", "kcal", "energy", nil},
	{"caloriesfromalcohol", "Calories from alcohol", "kcal", "energy", nil},
	{"totalfat", "Total fat", "g", "macro", dv(78)},
	{"saturatedfat", "Saturated fat", "g", "macro", dv(20)},
	{"transfattyacids", "Trans fat", "g", "macro", nil},
	{"monounsaturatedfat", "Monounsaturated fat", "g", "macro", nil},
	{"polyunsaturatedfat", "Polyunsaturated fat", "g", "macro", nil},
	{"cholesterol", "Cholesterol", "mg", "macro", dv(300)},
	{"sodium", "Sodium", "mg", "macro", dv(2300)},
	{"totalcarbohydrate", "Total carbohydrate", "g", "macro", dv(275)},
	{"fiber", "Dietary fiber", "g", "macro", dv(28)},
	{"sugar", "Total sugars", "g", "macro", nil},
	{"sugaralcohols", "Sugar alcohols", "g", "macro", nil},
	{"protein", "Protein", "g", "macro", dv(50)},
	{"vitamina", "Vitamin A", "IU", "vitamin", dv(5000)},
	{"vitaminc", "Vitamin C", "mg", "vitamin", dv(90)},
	{"vitamind", "Vitamin D", "IU", "vitamin", dv(800)},
	{"vitamine", "Vitamin E", "mg", "vitamin", dv(15)},
	{"vitamink", "Vitamin K", "µg", "vitamin", dv(120)},
	{"thiamin", "Thiamin", "mg", "vitamin", dv(1.2)},
	{"riboflavin", "Riboflavin", "mg", "vitamin", dv(1.3)},
	{"niacin", "Niacin", "mg", "vitamin", dv(16)},
	{"vitaminb6", "Vitamin B6", "mg", "vitamin", dv(1.7)},
	{"folate", "Folate", "µg", "vitamin", dv(400)},
	{"vitaminb12", "Vitamin B12", "µg", "vitamin", dv(2.4)},
	{"biotin", "Biotin", "µg", "vitamin", dv(30)},
	{"pantothenicacid", "Pantothenic acid", "mg", "vitamin", dv(5)},
	{"calcium", "Calcium", "mg", "mineral", dv(1300)},
	{"iron", "Iron", "mg", "mineral", dv(18)},
	{"phosphorus", "Phosphorus", "mg", "mineral", dv(1250)},
	{"potassium", "Potassium", "mg", "mineral", dv(4700)},
	{"magnesium", "Magnesium", "mg", "mineral", dv(420)},
	{"zinc", "Zinc", "mg", "mineral", dv(11)},
	{"copper", "Copper", "mg", "mineral", dv(0.9)},
	{"manganese", "Manganese", "mg", "mineral", dv(2.3)},
	{"selenium", "Selenium", "µg", "mineral", dv(55)},
	{"water", "Water", "g", "other", nil},
	{"ash", "Ash", "g", "other", nil},
	{"alcohol", "Alcohol", "g", "other", nil},
	{"caffeine", "Caffeine", "mg", "other", nil},
}

func seedNutrients(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, n := range Nutrients {
		if _, err := tx.Exec(`INSERT INTO nutrient(key,name,unit,category,daily_value,sort) VALUES(?,?,?,?,?,?)
			ON CONFLICT(key) DO UPDATE SET name=excluded.name, unit=excluded.unit, category=excluded.category,
			daily_value=excluded.daily_value, sort=excluded.sort`,
			n.Key, n.Name, n.Unit, n.Category, n.DailyValue, i); err != nil {
			return err
		}
	}
	return tx.Commit()
}
