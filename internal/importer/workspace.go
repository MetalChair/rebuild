package importer

import "strings"

func (im *imp) workspace() error {
	if err := im.groceryLists(); err != nil {
		return err
	}
	for _, spec := range []struct {
		file   string
		query  string
		values func(row) []any
	}{
		{"t_menu", "INSERT INTO menu(id, name, comments, servings) VALUES(?, ?, ?, ?)", func(r row) []any {
			return []any{r.int("menuid"), r.str("menuname"), r.str("comments"), r.numOr("servings", 1)}
		}},
		{"t_menuitem", `INSERT INTO menu_line(id, menu_id, idx, name, kind, recipe_id, food_id, quantity)
           SELECT ?, id, ?, ?, ?, (SELECT id FROM recipe WHERE id=?), (SELECT id FROM food WHERE id=?), ? FROM menu WHERE id=?`, func(r row) []any {
			return []any{r.int("menuitemid"), r.int("itemindex"), r.str("itemname"), r.str("itemtype"), r.ref("recipeid"), r.ref("ingredientid"), combine(r, "ingredientquantity", "ingredientunit"), r.int("menuid")}
		}},
		{"t_pantryitem", "INSERT INTO pantry(id, name, quantity, unit, comments) VALUES(?, ?, ?, ?, ?)", func(r row) []any {
			return []any{r.int("pantryitemid"), r.str("itemname"), max(0, r.numOr("onhandquantity", 0)), r.str("onhandmeasuredescription"), r.str("comments")}
		}},
		{"t_store", "INSERT INTO shopping_store(id, name, address, comments) VALUES(?, ?, ?, ?)", func(r row) []any {
			return []any{r.int("storeid"), r.str("name"), r.str("fulladdress"), r.str("comments")}
		}},
	} {
		rows, err := im.read(spec.file)
		if err != nil {
			return err
		}
		for _, r := range rows {
			if _, err := im.tx.Exec(spec.query, spec.values(r)...); err != nil {
				return err
			}
		}
	}
	return nil
}

func combine(r row, quantity, unit string) string {
	return strings.TrimSpace(r.str(quantity) + " " + r.str(unit))
}

func (im *imp) groceryLists() error {
	lists, err := im.read("t_grocerylist")
	if err != nil {
		return err
	}
	ids := map[int64]int64{}
	for i, list := range lists {
		id := int64(i + 1)
		name := list.str("name")
		if name == "" {
			name = "Grocery List"
		}
		if _, err := im.tx.Exec(`INSERT INTO grocery_list(id, name) VALUES(?, ?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name`, id, name); err != nil {
			return err
		}
		ids[list.int("grocerylistid")] = id
	}
	items, err := im.read("t_grocerylistitem")
	if err != nil {
		return err
	}
	for _, item := range items {
		itemID := item.int("grocerylistitemid")
		name := item.str("ingredient")
		if name == "" {
			continue
		}
		listID := ids[item.int("grocerylistid")]
		if listID == 0 {
			listID = 1
		}
		if _, err := im.tx.Exec("INSERT INTO grocery(id, name, quantity) VALUES(?, ?, ?)", itemID, name, combine(item, "quantity", "unit")); err != nil {
			return err
		}
		if _, err := im.tx.Exec("INSERT INTO grocery_list_item(item_id, list_id) VALUES(?, ?)", itemID, listID); err != nil {
			return err
		}
	}
	return nil
}
