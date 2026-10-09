export type PantryPackageKey = "essential" | "family" | "complete";
export type PantryItemCategory = "pantry" | "protein" | "produce_home";

export type PantryDemoItem = {
  name: string;
  quantity: string;
  category: PantryItemCategory;
};

export type PantryDemoPackage = {
  id: PantryPackageKey;
  name: string;
  audience: string;
  imageUrl: string;
  price: number;
  items: PantryDemoItem[];
};

const item = (name: string, quantity: string, category: PantryItemCategory): PantryDemoItem => ({ name, quantity, category });

export const PANTRY_DEMO_PACKAGES: PantryDemoPackage[] = [
  {
    id: "essential",
    name: "Compra Esencial",
    audience: "1–2 personas",
    imageUrl: "/images/shop-essential.jpg",
    price: 69,
    items: [
      item("Arroz", "5 lb", "pantry"), item("Frijoles negros", "2 lb", "pantry"),
      item("Aceite vegetal", "48 oz", "pantry"), item("Leche", "1 galón", "protein"),
      item("Huevos", "18 unidades", "protein"), item("Pan blanco", "1 paquete", "pantry"),
      item("Tortillas de maíz", "30 unidades", "pantry"), item("Azúcar", "4 lb", "pantry"),
      item("Pasta", "2 paquetes", "pantry"), item("Pollo", "3 lb", "protein"),
      item("Plátanos", "6 unidades", "produce_home"), item("Tomates", "4 unidades", "produce_home"),
      item("Cebollas", "3 unidades", "produce_home"), item("Papas", "3 lb", "produce_home"),
    ],
  },
  {
    id: "family",
    name: "Compra Familiar",
    audience: "3–4 personas",
    imageUrl: "/images/shop-family.jpg",
    price: 169,
    items: [
      item("Arroz", "10 lb", "pantry"), item("Frijoles negros", "4 lb", "pantry"),
      item("Aceite vegetal", "1 galón", "pantry"), item("Leche", "2 galones", "protein"),
      item("Huevos", "30 unidades", "protein"), item("Pan blanco", "2 paquetes", "pantry"),
      item("Tortillas de maíz", "60 unidades", "pantry"), item("Azúcar", "8 lb", "pantry"),
      item("Pasta", "4 paquetes", "pantry"), item("Pollo", "6 lb", "protein"),
      item("Carne molida", "3 lb", "protein"), item("Queso fresco", "2 lb", "protein"),
      item("Crema o yogurt", "2 unidades", "protein"), item("Cereal", "1 caja", "pantry"),
      item("Jugo", "2 unidades", "pantry"), item("Plátanos", "12 unidades", "produce_home"),
      item("Manzanas", "8 unidades", "produce_home"), item("Tomates", "8 unidades", "produce_home"),
      item("Cebollas", "5 unidades", "produce_home"), item("Papas", "5 lb", "produce_home"),
    ],
  },
  {
    id: "complete",
    name: "Compra Completa",
    audience: "hogares de 5 personas o más",
    imageUrl: "/images/shop-complete.jpg",
    price: 349,
    items: [
      item("Arroz", "20 lb", "pantry"), item("Frijoles negros", "8 lb", "pantry"),
      item("Aceite vegetal", "2 galones", "pantry"), item("Leche", "3 galones", "protein"),
      item("Huevos", "60 unidades", "protein"), item("Pan blanco", "3 paquetes", "pantry"),
      item("Tortillas de maíz", "90 unidades", "pantry"), item("Azúcar", "10 lb", "pantry"),
      item("Pasta", "6 paquetes", "pantry"), item("Pollo", "10 lb", "protein"),
      item("Carne de res", "5 lb", "protein"), item("Carne de cerdo", "5 lb", "protein"),
      item("Queso fresco", "3 lb", "protein"), item("Crema o yogurt", "4 unidades", "protein"),
      item("Cereal", "2 cajas", "pantry"), item("Jugo", "4 unidades", "pantry"),
      item("Salsa para cocinar", "3 frascos", "pantry"), item("Papas", "10 lb", "produce_home"),
      item("Tomates", "12 unidades", "produce_home"), item("Cebollas", "8 unidades", "produce_home"),
      item("Frutas surtidas", "1 paquete familiar", "produce_home"), item("Verduras surtidas", "1 paquete familiar", "produce_home"),
      item("Papel higiénico", "12 rollos", "produce_home"), item("Toallas de papel", "4 rollos", "produce_home"),
      item("Detergente o limpiador", "1 unidad", "produce_home"), item("Jabón para platos", "1 unidad", "produce_home"),
    ],
  },
];

export function getPantryDemoPackage(id: string | null | undefined): PantryDemoPackage | null {
  return PANTRY_DEMO_PACKAGES.find((entry) => entry.id === id) ?? null;
}
