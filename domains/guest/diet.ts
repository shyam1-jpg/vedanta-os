/**
 * The Vedanta kitchen is pure vegetarian: no eggs and no onion-family ingredients
 * (onion, garlic, leek, shallot, chives, scallion). Those are the house default,
 * not a special request. Flag only real exceptions for the kitchen and for Parslia.
 */

export const HOUSE_KITCHEN = {
  vegetarian: true,
  eggs: false,
  onionFamily: false,
} as const;

const HOUSE_DEFAULT_DIETS = new Set([
  "vegetarian",
  "veg",
  "no_onion_garlic",
  "no_onion",
  "no_garlic",
  "no_eggs",
  "no_egg",
  "eggless",
]);

export type DietFlag = { code: string; label: string };

export const UK_ALLERGENS = ["celery", "cereals_gluten", "crustaceans", "eggs", "fish", "lupin", "milk", "molluscs", "mustard", "nuts", "peanuts", "sesame", "soya", "sulphites"] as const;

const ALLERGEN_LABEL: Record<string, string> = {
  celery: "Celery",
  cereals_gluten: "Gluten",
  crustaceans: "Crustaceans — not used in this kitchen",
  eggs: "Eggs — not used in this kitchen",
  fish: "Fish — not used in this kitchen",
  lupin: "Lupin",
  milk: "Milk",
  molluscs: "Molluscs — not used in this kitchen",
  mustard: "Mustard",
  nuts: "Tree nuts",
  peanuts: "Peanuts",
  sesame: "Sesame",
  soya: "Soya",
  sulphites: "Sulphites",
};

const DIET_LABEL: Record<string, string> = {
  vegan: "Vegan",
  jain: "Jain — no root vegetables",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
  nut_free: "Nut-free",
  halal: "Halal",
  kosher: "Kosher",
};

export function allergenLabel(code: string): string {
  return ALLERGEN_LABEL[code] ?? code.replace(/_/g, " ");
}

export function dietLabel(code: string): string {
  return DIET_LABEL[code] ?? code.replace(/_/g, " ");
}

export function dietFlags(input: {
  diet?: string[] | null;
  allergens?: string[] | null;
  notes?: string | null;
}): DietFlag[] {
  const flags: DietFlag[] = [];
  const seen = new Set<string>();
  const add = (code: string, label: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    flags.push({ code, label });
  };
  for (const raw of input.diet ?? []) {
    const code = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!code || HOUSE_DEFAULT_DIETS.has(code)) continue;
    add(code, DIET_LABEL[code] ?? code.replace(/_/g, " "));
  }
  for (const raw of input.allergens ?? []) {
    const code = raw.trim().toLowerCase();
    if (!code) continue;
    add(code, ALLERGEN_LABEL[code] ?? code.replace(/_/g, " "));
  }
  if (input.notes?.trim()) add("notes", "Kitchen note");
  return flags;
}

export function isHouseDefaultDiet(input: { diet?: string[] | null; allergens?: string[] | null; notes?: string | null }): boolean {
  return dietFlags(input).length === 0;
}
