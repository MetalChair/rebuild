import type { Recipe } from "./api";
import { scaleQuantity } from "./util";

export function groceryIngredients(recipe: Recipe, servings: number) {
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1;
  return recipe.ingredients.filter(i => !i.is_heading && i.text.trim()).map(i => ({
    name: i.text,
    quantity: [scaleQuantity(i.quantity, factor), i.unit].filter(Boolean).join(" "),
  }));
}
