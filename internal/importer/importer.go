// Package importer converts the legacy Diet Pro CSV export (one file per
// Access table, Windows-1252 encoded) into the modern SQLite schema.
package importer

import (
	"bytes"
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"dietpro/internal/store"
)

// Options configures an import run.
type Options struct {
	CSVDir    string // directory containing t_*.csv
	ImagesDir string // legacy "Images" directory; optional
	Log       io.Writer
}

type row map[string]string

type table []row

// Run imports into db, which must be freshly created (empty tables).
func Run(db *sql.DB, opt Options) error {
	if opt.Log == nil {
		opt.Log = io.Discard
	}
	im := &imp{dir: opt.CSVDir, log: opt.Log, images: map[string]string{}}
	if opt.ImagesDir != "" {
		entries, err := os.ReadDir(opt.ImagesDir)
		if err != nil {
			return fmt.Errorf("read images dir: %w", err)
		}
		for _, e := range entries {
			if !e.IsDir() {
				im.images[strings.ToLower(e.Name())] = e.Name()
			}
		}
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	im.tx = tx

	steps := []struct {
		name string
		fn   func() error
	}{
		{"measures", im.measures},
		{"foods", im.foods},
		{"recipes", im.recipes},
		{"profiles & diary", im.diary},
		{"activities", im.activities},
		{"reference", im.reference},
		{"workspace records", im.workspace},
		{"images", func() error { return im.media(opt.ImagesDir) }},
	}
	for _, s := range steps {
		start := time.Now()
		if err := s.fn(); err != nil {
			return fmt.Errorf("%s: %w", s.name, err)
		}
		fmt.Fprintf(opt.Log, "  %-18s %6s\n", s.name, time.Since(start).Round(time.Millisecond))
	}
	if _, err := tx.Exec(`INSERT OR REPLACE INTO meta(key,value) VALUES('imported_at',?),('import_source',?)`,
		time.Now().UTC().Format(time.RFC3339), opt.CSVDir); err != nil {
		return err
	}
	return tx.Commit()
}

type imp struct {
	dir     string
	tx      *sql.Tx
	log     io.Writer
	images  map[string]string // lower-case basename -> actual filename
	foodIDs map[int64]bool
}

// --- CSV helpers -----------------------------------------------------------

// cp1252 maps bytes 0x80-0x9F, the only range where Windows-1252 differs from Latin-1.
var cp1252 = [32]rune{
	'€', 0x81, '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 0x8D, 'Ž', 0x8F,
	0x90, '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 0x9D, 'ž', 'Ÿ',
}

func decode1252(b []byte) []byte {
	var out bytes.Buffer
	out.Grow(len(b))
	for _, c := range b {
		switch {
		case c < 0x80:
			out.WriteByte(c)
		case c < 0xA0:
			out.WriteRune(cp1252[c-0x80])
		default:
			out.WriteRune(rune(c))
		}
	}
	return out.Bytes()
}

func (im *imp) read(name string) (table, error) {
	raw, err := os.ReadFile(filepath.Join(im.dir, name+".csv"))
	if os.IsNotExist(err) {
		fmt.Fprintf(im.log, "  (skipping missing %s.csv)\n", name)
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// The export is Windows-1252. A user database re-exported as UTF-8 also works.
	if !utf8.Valid(raw) {
		raw = decode1252(raw)
	}
	r := csv.NewReader(bytes.NewReader(raw))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	recs, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("%s.csv: %w", name, err)
	}
	if len(recs) == 0 {
		return nil, nil
	}
	hdr := recs[0]
	for i := range hdr {
		hdr[i] = strings.ToLower(strings.TrimSpace(hdr[i]))
	}
	t := make(table, 0, len(recs)-1)
	for _, rec := range recs[1:] {
		m := make(row, len(hdr))
		for i, h := range hdr {
			if i < len(rec) {
				m[h] = strings.TrimSpace(rec[i])
			}
		}
		t = append(t, m)
	}
	return t, nil
}

func (r row) str(k string) string { return r[k] }

func (r row) int(k string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(r[k]), 10, 64)
	return n
}

// ref returns nil for empty or zero foreign keys.
func (r row) ref(k string) any {
	if n := r.int(k); n != 0 {
		return n
	}
	return nil
}

// num parses numbers and Access currency strings such as "$1.31" or "($1.31)".
func (r row) num(k string) *float64 {
	s := strings.TrimSpace(r[k])
	if s == "" {
		return nil
	}
	neg := strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")")
	s = strings.NewReplacer("(", "", ")", "", "$", "", ",", "").Replace(s)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	if neg {
		f = -f
	}
	return &f
}

func (r row) numOr(k string, def float64) float64 {
	if v := r.num(k); v != nil {
		return *v
	}
	return def
}

func (r row) flag(k string) bool { return strings.EqualFold(r[k], "Y") }

// date converts "4/29/2005 0:00:00" to "2005-04-29".
func (r row) date(k string) string {
	s := strings.TrimSpace(r[k])
	if s == "" {
		return ""
	}
	if i := strings.IndexByte(s, ' '); i > 0 {
		s = s[:i]
	}
	for _, layout := range []string{"1/2/2006", "2006-01-02", "1/2/06"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("2006-01-02")
		}
	}
	return ""
}

// photo maps a hard-coded Windows path to an imported media name.
func (im *imp) photo(p string) string {
	if p == "" {
		return ""
	}
	base := p
	if i := strings.LastIndexAny(p, `\/`); i >= 0 {
		base = p[i+1:]
	}
	return im.images[strings.ToLower(base)]
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (im *imp) exec(q string, rows table, args func(row) []any) error {
	st, err := im.tx.Prepare(q)
	if err != nil {
		return err
	}
	defer st.Close()
	for _, r := range rows {
		a := args(r)
		if a == nil {
			continue
		}
		if _, err := st.Exec(a...); err != nil {
			return fmt.Errorf("%w (%v)", err, a)
		}
	}
	return nil
}

// --- Import steps ----------------------------------------------------------

func (im *imp) measures() error {
	t, err := im.read("t_measure")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO measure(id,description,type,unit_singular,unit_plural) VALUES(?,?,?,?,?)`, t,
		func(r row) []any {
			return []any{r.int("measureid"), r.str("description"), r.str("type"), r.str("orderunitsingular"), r.str("orderunitplural")}
		}); err != nil {
		return err
	}
	_, err = im.tx.Exec(`INSERT OR IGNORE INTO measure(id,description,type,unit_singular,unit_plural)
		VALUES(?,'1 gram','Weight (Mass)','g','g')`, store.GramMeasureID)
	return err
}

func (im *imp) foods() error {
	groups, err := im.read("t_ingredientgroup")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO food_group(id,parent_id,name) VALUES(?,?,?)`, groups, func(r row) []any {
		return []any{r.int("ingredientgroupid"), r.int("parentgroupid"), r.str("name")}
	}); err != nil {
		return err
	}

	foods, err := im.read("t_ingredient")
	if err != nil {
		return err
	}
	im.foodIDs = map[int64]bool{}
	if err := im.exec(`INSERT INTO food(id,name,common_name,group_id,nutrition_source,is_user,source,webpage,comments,refuse,photo,default_measure_id,aisle)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, foods, func(r row) []any {
		id := r.int("ingredientid")
		im.foodIDs[id] = true
		return []any{id, r.str("name"), r.str("commonname"), r.int("ingredientgroupid"), r.str("nutritionsource"),
			boolInt(r.str("nutritionsource") == "User"), r.str("source"), r.str("webpage"), r.str("comments"),
			r.num("refuse"), im.photo(r.str("photographpath")), r.int("selectedmeasureid"), r.str("groceryaisle")}
	}); err != nil {
		return err
	}

	st, err := im.tx.Prepare(`INSERT INTO food_nutrient(food_id,nutrient,amount) VALUES(?,?,?)`)
	if err != nil {
		return err
	}
	defer st.Close()
	for _, r := range foods {
		if r["caloriesfromcarbs"] == "" {
			r["caloriesfromcarbs"] = r["caloriesfromcarbohydrates"]
		}
		for _, n := range store.Nutrients {
			if v := r.num(n.Key); v != nil {
				if _, err := st.Exec(r.int("ingredientid"), n.Key, *v); err != nil {
					return err
				}
			}
		}
	}

	assoc, err := im.read("t_ingredientgroupassociation")
	if err != nil {
		return err
	}
	// Association tables are closures; distance 1 is the direct parent.
	if err := im.exec(`INSERT OR IGNORE INTO food_group_member(group_id,food_id) VALUES(?,?)`, assoc, func(r row) []any {
		if r.int("distance") != 1 || !im.foodIDs[r.int("ingredientid")] {
			return nil
		}
		return []any{r.int("ingredientgroupid"), r.int("ingredientid")}
	}); err != nil {
		return err
	}
	if _, err := im.tx.Exec(`INSERT OR IGNORE INTO food_group_member(group_id,food_id) SELECT group_id,id FROM food WHERE group_id<>0`); err != nil {
		return err
	}

	measures, err := im.read("t_ingredientmeasure")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT OR IGNORE INTO food_measure(food_id,measure_id,grams) VALUES(?,?,?)`, measures, func(r row) []any {
		g := r.num("gramweight")
		if g == nil || *g <= 0 || !im.foodIDs[r.int("ingredientid")] {
			return nil
		}
		return []any{r.int("ingredientid"), r.int("measureid"), *g}
	}); err != nil {
		return err
	}
	if _, err := im.tx.Exec(`INSERT OR IGNORE INTO food_measure(food_id,measure_id,grams) SELECT id,?,1 FROM food`, store.GramMeasureID); err != nil {
		return err
	}

	notes, err := im.read("t_ingredientnote")
	if err != nil {
		return err
	}
	return im.exec(`INSERT INTO food_note(id,food_id,idx,text) VALUES(?,?,?,?)`, notes, func(r row) []any {
		if !im.foodIDs[r.int("ingredientid")] {
			return nil
		}
		return []any{r.int("ingredientnoteid"), r.int("ingredientid"), r.int("ingredientnoteindex"), r.str("notetext")}
	})
}

func (im *imp) recipes() error {
	books, err := im.read("t_cookbook")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO cookbook(id,name,comments,author,publisher) VALUES(?,?,?,?,?)`, books, func(r row) []any {
		return []any{r.int("cookbookid"), r.str("name"), r.str("comments"), r.str("author"), r.str("publisher")}
	}); err != nil {
		return err
	}
	groups, err := im.read("t_recipegroup")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO recipe_group(id,parent_id,cookbook_id,name) VALUES(?,?,?,?)`, groups, func(r row) []any {
		return []any{r.int("recipegroupid"), r.int("parentgroupid"), r.int("cookbookid"), r.str("name")}
	}); err != nil {
		return err
	}

	nut, err := im.read("t_recipenutrition")
	if err != nil {
		return err
	}
	nutByRecipe := map[int64]row{}
	for _, r := range nut {
		nutByRecipe[r.int("recipeid")] = r
	}

	recipes, err := im.read("t_recipe")
	if err != nil {
		return err
	}
	ids := map[int64]bool{}
	if err := im.exec(`INSERT INTO recipe(id,name,subtitle,servings,yield,serving_size,comments,prep_minutes,cook_minutes,ready_minutes,
		author,source,webpage,photo,source_photo,types,rating,nutrition_mode,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		recipes, func(r row) []any {
			id := r.int("recipeid")
			ids[id] = true
			mode, size := "computed", ""
			if n, ok := nutByRecipe[id]; ok {
				size = n.str("servingsize")
				if !n.flag("calculatedfromrecipeflag") {
					mode = "label"
				}
			}
			servings := r.numOr("servings", 1)
			if servings <= 0 {
				servings = 1
			}
			created := r.date("createdate")
			return []any{id, r.str("recipename"), r.str("subtitle"), servings, r.str("yield"), size, r.str("comments"),
				r.int("preparationtime"), r.int("cookingtime"), r.int("readyintime"), r.str("author"), r.str("source"),
				r.str("webpage"), im.photo(r.str("photographpath")), im.photo(r.str("sourcephotographpath")),
				r.str("recipetypes"), r.num("averagerating"), mode, created, created}
		}); err != nil {
		return err
	}

	st, err := im.tx.Prepare(`INSERT INTO recipe_label_nutrient(recipe_id,nutrient,amount) VALUES(?,?,?)`)
	if err != nil {
		return err
	}
	defer st.Close()
	for _, r := range nut {
		if r.flag("calculatedfromrecipeflag") || !ids[r.int("recipeid")] {
			continue
		}
		for _, n := range store.Nutrients {
			if v := r.num(n.Key); v != nil {
				if _, err := st.Exec(r.int("recipeid"), n.Key, *v); err != nil {
					return err
				}
			}
		}
	}

	assoc, err := im.read("t_recipegroupassociation")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT OR IGNORE INTO recipe_group_member(group_id,recipe_id) VALUES(?,?)`, assoc, func(r row) []any {
		if r.int("distance") != 1 || !ids[r.int("recipeid")] {
			return nil
		}
		return []any{r.int("recipegroupid"), r.int("recipeid")}
	}); err != nil {
		return err
	}

	ings, err := im.read("t_recipeingredient")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO recipe_ingredient(id,recipe_id,idx,is_heading,quantity,unit,text,food_id,measure_id,measure_qty)
		VALUES(?,?,?,?,?,?,?,?,?,?)`, ings, func(r row) []any {
		if !ids[r.int("recipeid")] {
			return nil
		}
		var food any
		if f := r.int("ingredientid"); im.foodIDs[f] {
			food = f
		}
		return []any{r.int("recipeingredientid"), r.int("recipeid"), r.int("ingredientindex"), boolInt(r.flag("heading")),
			r.str("quantitytext"), r.str("unittext"), r.str("ingredienttext"), food, r.ref("measureid"), r.num("measurequantity")}
	}); err != nil {
		return err
	}

	steps, err := im.read("t_recipeprocedure")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO recipe_step(id,recipe_id,idx,is_heading,text,photo) VALUES(?,?,?,?,?,?)`, steps, func(r row) []any {
		if !ids[r.int("recipeid")] {
			return nil
		}
		return []any{r.int("recipeprocedureid"), r.int("recipeid"), r.int("procedureindex"), boolInt(r.flag("heading")),
			r.str("proceduretext"), im.photo(r.str("photographpath"))}
	}); err != nil {
		return err
	}

	notes, err := im.read("t_authornote")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO recipe_note(id,recipe_id,idx,text) VALUES(?,?,?,?)`, notes, func(r row) []any {
		if !ids[r.int("recipeid")] {
			return nil
		}
		return []any{r.int("authornoteid"), r.int("recipeid"), r.int("authornoteindex"), r.str("authornotetext")}
	}); err != nil {
		return err
	}

	reviews, err := im.read("t_recipereview")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO recipe_review(id,recipe_id,date,rating,reviewer,text) VALUES(?,?,?,?,?,?)`, reviews, func(r row) []any {
		if !ids[r.int("recipeid")] {
			return nil
		}
		return []any{r.int("recipereviewid"), r.int("recipeid"), r.date("reviewdate"), r.ref("rating"), r.str("reviewer"), r.str("reviewtext")}
	}); err != nil {
		return err
	}

	types, err := im.read("t_recipetype")
	if err != nil {
		return err
	}
	return im.exec(`INSERT INTO recipe_type(id,name) VALUES(?,?)`, types, func(r row) []any {
		return []any{r.int("recipetypeid"), r.str("description")}
	})
}

func (im *imp) diary() error {
	meals, err := im.read("t_meal")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO meal(id,name,abbr) VALUES(?,?,?)`, meals, func(r row) []any {
		return []any{r.int("mealid"), r.str("mealname"), r.str("abbreviation")}
	}); err != nil {
		return err
	}

	profiles, err := im.read("t_profile")
	if err != nil {
		return err
	}
	pids := map[int64]bool{}
	if err := im.exec(`INSERT INTO profile(id,name,gender,age,height_cm,start_date,end_date,start_weight_kg,goal_weight_kg,
		weekly_change_kg,budget_mode,calorie_budget,comments) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, profiles, func(r row) []any {
		id := r.int("profileid")
		pids[id] = true
		// Preserve the legacy budget exactly; the user can switch to automatic.
		return []any{id, r.str("profilename"), r.str("gender"), r.ref("age"), r.num("heightcm"), r.date("startdate"), r.date("enddate"),
			r.num("startingweightkg"), r.num("goalweightkg"), r.numOr("planneddailyweightlosskg", 0) * 7, "manual",
			r.num("caloriebudgetcalories"), r.str("comments")}
	}); err != nil {
		return err
	}

	days, err := im.read("t_calendarday")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT OR REPLACE INTO weight_log(profile_id,date,weight_kg) VALUES(?,?,?)`, days, func(r row) []any {
		w := r.num("weightkg")
		if w == nil || *w <= 0 || !pids[r.int("profileid")] || r.date("calendardate") == "" {
			return nil
		}
		return []any{r.int("profileid"), r.date("calendardate"), *w}
	}); err != nil {
		return err
	}

	notes, err := im.read("t_calendarnote")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO day_note(profile_id,date,text) VALUES(?,?,?)
		ON CONFLICT(profile_id,date) DO UPDATE SET text=text||char(10)||excluded.text`, notes, func(r row) []any {
		if !pids[r.int("profileid")] {
			return nil
		}
		return []any{r.int("profileid"), r.date("calendardate"), r.str("calendarnotetext")}
	}); err != nil {
		return err
	}

	entries, err := im.read("t_calendarentry")
	if err != nil {
		return err
	}
	return im.exec(`INSERT INTO diary_entry(id,profile_id,date,meal_id,idx,kind,food_id,measure_id,measure_qty,recipe_id,servings,text)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, entries, func(r row) []any {
		if !pids[r.int("profileid")] {
			return nil
		}
		kind := "text"
		switch {
		case r.str("entrytype") == "Ingredient" && im.foodIDs[r.int("ingredientid")]:
			kind = "food"
		case r.str("entrytype") == "Recipe" && r.int("recipeid") != 0:
			kind = "recipe"
		}
		servings := r.num("servings")
		if kind == "recipe" && (servings == nil || *servings == 0) {
			one := 1.0
			servings = &one
		}
		return []any{r.int("calendarentryid"), r.int("profileid"), r.date("calendarentrydate"), r.int("mealid"), r.int("entryindex"),
			kind, r.ref("ingredientid"), r.ref("ingredientmeasureid"), r.num("ingredientmeasurequantity"), r.ref("recipeid"),
			servings, r.str("entrytext")}
	})
}

func (im *imp) activities() error {
	groups, err := im.read("t_activitygroup")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO activity_group(id,parent_id,name) VALUES(?,?,?)`, groups, func(r row) []any {
		return []any{r.int("activitygroupid"), r.int("parentgroupid"), r.str("name")}
	}); err != nil {
		return err
	}
	acts, err := im.read("t_activity")
	if err != nil {
		return err
	}
	if err := im.exec(`INSERT INTO activity(id,name,group_id,kcal_per_lb_minute,source) VALUES(?,?,?,?,?)`, acts, func(r row) []any {
		return []any{r.int("activityid"), r.str("name"), r.int("activitygroupid"), r.numOr("caloriesperpoundperminute", 0), r.str("source")}
	}); err != nil {
		return err
	}
	log, err := im.read("t_calendaractivity")
	if err != nil {
		return err
	}
	return im.exec(`INSERT INTO activity_log(id,profile_id,date,activity_id,minutes,calories,comments) VALUES(?,?,?,?,?,?,?)`, log, func(r row) []any {
		return []any{r.int("calendaractivityid"), r.int("profileid"), r.date("activitydate"), r.int("activityid"),
			r.numOr("minutes", 0), r.numOr("calories", 0), r.str("comments")}
	})
}

func (im *imp) reference() error {
	items, err := im.read("t_glossaryitem")
	if err != nil {
		return err
	}
	texts, err := im.read("t_glossaryitemtext")
	if err != nil {
		return err
	}
	sort.SliceStable(texts, func(i, j int) bool { return texts[i].int("textindex") < texts[j].int("textindex") })
	body := map[int64][]string{}
	for _, t := range texts {
		id := t.int("glossaryitemid")
		body[id] = append(body[id], t.str("itemtext"))
	}
	if err := im.exec(`INSERT INTO glossary(id,name,source,webpage,text) VALUES(?,?,?,?,?)`, items, func(r row) []any {
		id := r.int("glossaryitemid")
		return []any{id, r.str("name"), r.str("source"), r.str("webpage"), strings.Join(body[id], "\n\n")}
	}); err != nil {
		return err
	}

	tgroups, err := im.read("t_cookingtechniquegroup")
	if err != nil {
		return err
	}
	groupName := map[int64]string{}
	for _, g := range tgroups {
		groupName[g.int("cookingtechniquegroupid")] = g.str("name")
	}
	tassoc, err := im.read("t_cookingtechniquegroupassociation")
	if err != nil {
		return err
	}
	techGroup := map[int64]string{}
	for _, a := range tassoc {
		if a.int("distance") == 1 {
			techGroup[a.int("cookingtechniqueid")] = groupName[a.int("cookingtechniquegroupid")]
		}
	}
	techs, err := im.read("t_cookingtechnique")
	if err != nil {
		return err
	}
	tids := map[int64]bool{}
	if err := im.exec(`INSERT INTO technique(id,name,group_name,source,webpage,comments) VALUES(?,?,?,?,?,?)`, techs, func(r row) []any {
		id := r.int("cookingtechniqueid")
		tids[id] = true
		g := techGroup[id]
		if g == "" {
			g = groupName[r.int("cookingtechniquegroupid")]
		}
		return []any{id, r.str("name"), g, r.str("source"), r.str("webpage"), r.str("comments")}
	}); err != nil {
		return err
	}
	steps, err := im.read("t_cookingtechniquetext")
	if err != nil {
		return err
	}
	return im.exec(`INSERT INTO technique_step(id,technique_id,idx,text,photo,numbered) VALUES(?,?,?,?,?,?)`, steps, func(r row) []any {
		if !tids[r.int("cookingtechniqueid")] {
			return nil
		}
		return []any{r.int("cookingtechniquetextid"), r.int("cookingtechniqueid"), r.int("textindex"), r.str("techniquetext"),
			im.photo(r.str("photographpath")), boolInt(r.flag("numberflag"))}
	})
}

var mimeTypes = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".png": "image/png", ".bmp": "image/bmp",
}

func (im *imp) media(dir string) error {
	if dir == "" {
		return nil
	}
	st, err := im.tx.Prepare(`INSERT OR REPLACE INTO media(name,mime,data) VALUES(?,?,?)`)
	if err != nil {
		return err
	}
	defer st.Close()
	for _, name := range im.images {
		mime, ok := mimeTypes[strings.ToLower(filepath.Ext(name))]
		if !ok {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		if _, err := st.Exec(name, mime, data); err != nil {
			return err
		}
	}
	return nil
}
