/**
 * Datos de demo para desarrollar la UI (npm run db:seed:demo). Editá libremente: el seed es
 * idempotente por slug del comercio (si ya existe, lo saltea).
 *
 * Precios en pesos (el seed los pasa a centavos). Días: 0 = domingo … 6 = sábado.
 */

export type DemoStatus = "APPROVED" | "PENDING_REVIEW" | "DRAFT";

export interface DemoProduct {
  name: string;
  description?: string;
  price: number;
  available?: boolean;
  /** [nombre, precio] — el cliente elige una y su precio reemplaza al del producto. */
  variants?: Array<[string, number]>;
  groups?: Array<{ name: string; min: number; max: number; options: Array<[string, number, number?]> }>;
}

export interface DemoMerchant {
  /** Usuario dueño: `npm run dev:token -w @pedilo/api -- --name <owner>` entra como él. */
  owner: string;
  name: string;
  legalName: string;
  /** DNI o número base para generar un CUIT válido. */
  taxBase: string;
  rubro: "gastronomia" | "kioscos" | "supermercados" | "electronica" | "emprendedores";
  city: "tostado" | "galvez";
  status: DemoStatus;
  phone: string;
  branch?: {
    name: string;
    address: string;
    notes?: string;
    pickup: boolean;
    delivery: boolean;
    /** [días, abre, cierra] */
    hours: Array<[number[], string, string]>;
    /** [nombre, descripción, costo, pedido mínimo] */
    zones?: Array<[string, string, number, number]>;
  };
  sections?: Array<{ name: string; products: DemoProduct[] }>;
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const TUE_TO_SUN = [0, 2, 3, 4, 5, 6];

const masa = { name: "Masa", min: 1, max: 1, options: [["Común", 0], ["Integral", 600]] as Array<[string, number]> };
const bebidas: DemoProduct[] = [
  { name: "Coca-Cola 1,5 L", price: 3800 },
  { name: "Sprite 1,5 L", price: 3600 },
  { name: "Agua mineral 500 ml", price: 1500 },
  { name: "Cerveza Quilmes 1 L", price: 4200, description: "Retornable: traé el envase." },
];

export const DEMO_MERCHANTS: DemoMerchant[] = [
  {
    owner: "esquina",
    name: "La Esquina de Tostado",
    legalName: "La Esquina SRL",
    taxBase: "3071000001",
    rubro: "gastronomia",
    city: "tostado",
    status: "APPROVED",
    phone: "3491 420100",
    branch: {
      name: "Centro",
      address: "San Martín 850",
      notes: "Frente a la plaza",
      pickup: true,
      delivery: true,
      hours: [
        [EVERY_DAY, "11:30", "15:00"],
        [EVERY_DAY, "19:30", "00:30"],
      ],
      zones: [
        ["Centro", "Bv. Roca a Belgrano, de 9 de Julio a Sarmiento", 1500, 8000],
        ["Barrio Norte", "Al norte de Bv. Roca hasta la ruta", 2200, 12000],
        ["Barrio Sur", "Al sur de Belgrano", 2200, 12000],
      ],
    },
    sections: [
      {
        name: "Pizzas",
        products: [
          {
            name: "Muzzarella",
            description: "Salsa de tomate, muzzarella y aceitunas verdes.",
            price: 9500,
            variants: [["Chica (4 porciones)", 7500], ["Grande (8 porciones)", 11500]],
            groups: [masa, { name: "Extras", min: 0, max: 3, options: [["Extra muzzarella", 1500, 2], ["Huevo", 800], ["Jamón", 1800]] }],
          },
          {
            name: "Napolitana",
            description: "Muzzarella, rodajas de tomate, ajo y orégano.",
            price: 13000,
            variants: [["Chica (4 porciones)", 8500], ["Grande (8 porciones)", 13000]],
            groups: [masa],
          },
          {
            name: "Fugazzeta rellena",
            description: "Doble masa rellena de muzzarella con cebolla gratinada.",
            price: 15500,
            groups: [masa],
          },
          {
            name: "Calabresa",
            description: "Muzzarella y longaniza calabresa.",
            price: 14000,
            available: false,
          },
        ],
      },
      {
        name: "Empanadas",
        products: [
          { name: "Carne cortada a cuchillo", price: 1400, variants: [["Unidad", 1400], ["Media docena", 7800], ["Docena", 14500]], groups: [{ name: "Cocción", min: 1, max: 1, options: [["Al horno", 0], ["Fritas", 0]] }] },
          { name: "Pollo", price: 1300, variants: [["Unidad", 1300], ["Media docena", 7200], ["Docena", 13500]] },
          { name: "Jamón y queso", price: 1300, variants: [["Unidad", 1300], ["Media docena", 7200], ["Docena", 13500]] },
          { name: "Humita", price: 1300, variants: [["Unidad", 1300], ["Media docena", 7200], ["Docena", 13500]] },
        ],
      },
      { name: "Bebidas", products: bebidas },
    ],
  },
  {
    owner: "burger",
    name: "Burger Club",
    legalName: "Martín Ruiz",
    taxBase: "2033000002",
    rubro: "gastronomia",
    city: "tostado",
    status: "APPROVED",
    phone: "3491 430200",
    branch: {
      name: "Burger Club",
      address: "Belgrano 1210",
      pickup: true,
      delivery: true,
      hours: [[TUE_TO_SUN, "19:00", "01:00"]],
      zones: [["Toda la ciudad", "Dentro del casco urbano", 1800, 9000]],
    },
    sections: [
      {
        name: "Hamburguesas",
        products: [
          {
            name: "Clásica",
            description: "Medallón de 150 g, lechuga, tomate y aderezo de la casa. Con papas.",
            price: 9800,
            groups: [
              { name: "Punto de la carne", min: 1, max: 1, options: [["Jugosa", 0], ["A punto", 0], ["Bien cocida", 0]] },
              { name: "Extras", min: 0, max: 4, options: [["Cheddar", 900, 2], ["Bacon", 1200, 2], ["Huevo frito", 800], ["Cebolla caramelizada", 700]] },
            ],
          },
          {
            name: "Doble cheddar",
            description: "Doble medallón, doble cheddar y bacon crocante. Con papas.",
            price: 13500,
            groups: [{ name: "Punto de la carne", min: 1, max: 1, options: [["Jugosa", 0], ["A punto", 0], ["Bien cocida", 0]] }],
          },
          { name: "Veggie", description: "Medallón de garbanzos y quinoa, palta y rúcula.", price: 10500 },
        ],
      },
      {
        name: "Para acompañar",
        products: [
          { name: "Papas fritas", price: 4500, variants: [["Chicas", 3500], ["Grandes", 5500]], groups: [{ name: "Salsas", min: 0, max: 2, options: [["Cheddar", 900], ["Barbacoa", 500], ["Alioli", 500]] }] },
          { name: "Aros de cebolla", price: 4800 },
        ],
      },
      { name: "Bebidas", products: bebidas.slice(0, 3) },
    ],
  },
  {
    owner: "polonorte",
    name: "Heladería Polo Norte",
    legalName: "Polo Norte Helados SRL",
    taxBase: "3071000003",
    rubro: "gastronomia",
    city: "tostado",
    status: "APPROVED",
    phone: "3491 440300",
    branch: {
      name: "Polo Norte",
      address: "Bv. Roca 455",
      pickup: true,
      delivery: true,
      hours: [[EVERY_DAY, "13:00", "01:00"]],
      zones: [["Centro", "Casco céntrico", 1200, 6000]],
    },
    sections: [
      {
        name: "Helados",
        products: [
          {
            name: "Helado por peso",
            description: "Elegí hasta 4 gustos.",
            price: 5500,
            variants: [["1/4 kg", 5500], ["1/2 kg", 9800], ["1 kg", 17500]],
            groups: [
              {
                name: "Gustos",
                min: 1,
                max: 4,
                options: [["Dulce de leche", 0], ["Chocolate", 0], ["Frutilla a la crema", 0], ["Limón", 0], ["Vainilla", 0], ["Sambayón", 0], ["Chocolate amargo", 0], ["Banana split", 0]],
              },
              { name: "Extras", min: 0, max: 2, options: [["Salsa de chocolate", 600], ["Cucuruchos (x2)", 500]] },
            ],
          },
        ],
      },
      { name: "Postres", products: [{ name: "Almendrado (porción)", price: 3200 }, { name: "Torta helada", price: 21000, available: false }] },
    ],
  },
  {
    owner: "kiosco",
    name: "Kiosco 24 hs El Sol",
    legalName: "Lucía Fernández",
    taxBase: "2738000004",
    rubro: "kioscos",
    city: "tostado",
    status: "APPROVED",
    phone: "3491 450400",
    branch: {
      name: "El Sol",
      address: "9 de Julio 300",
      pickup: true,
      delivery: true,
      hours: [[EVERY_DAY, "00:00", "24:00"]],
      zones: [["Cerca", "Hasta 10 cuadras", 1000, 3000]],
    },
    sections: [
      {
        name: "Golosinas",
        products: [
          { name: "Alfajor triple", price: 1500 },
          { name: "Chocolate con leche 100 g", price: 2800 },
          { name: "Caramelos surtidos (bolsa)", price: 1200 },
        ],
      },
      {
        name: "Snacks",
        products: [
          { name: "Papas fritas 150 g", price: 2900 },
          { name: "Maní salado 200 g", price: 1900 },
        ],
      },
      { name: "Bebidas", products: [...bebidas.slice(0, 3), { name: "Energizante 473 ml", price: 3200 }] },
    ],
  },
  {
    owner: "donluis",
    name: "Súper Don Luis",
    legalName: "Luis Gómez",
    taxBase: "2025000005",
    rubro: "supermercados",
    city: "tostado",
    status: "APPROVED",
    phone: "3491 460500",
    branch: {
      name: "Don Luis",
      address: "Mitre 640",
      pickup: true,
      delivery: true,
      hours: [
        [[1, 2, 3, 4, 5, 6], "08:00", "13:00"],
        [[1, 2, 3, 4, 5, 6], "16:30", "21:00"],
      ],
      zones: [["Toda la ciudad", "Casco urbano", 2000, 20000]],
    },
    sections: [
      {
        name: "Almacén",
        products: [
          { name: "Yerba mate 1 kg", price: 6200 },
          { name: "Fideos tirabuzón 500 g", price: 1400 },
          { name: "Arroz largo fino 1 kg", price: 2100 },
          { name: "Aceite de girasol 1,5 L", price: 4300 },
          { name: "Azúcar 1 kg", price: 1700 },
        ],
      },
      {
        name: "Lácteos",
        products: [
          { name: "Leche entera 1 L", price: 1600 },
          { name: "Yogur bebible frutilla 1 L", price: 2700 },
          { name: "Queso cremoso (por kg)", price: 11500, variants: [["1/4 kg", 2900], ["1/2 kg", 5800], ["1 kg", 11500]] },
        ],
      },
      { name: "Limpieza", products: [{ name: "Lavandina 2 L", price: 1800 }, { name: "Detergente 750 ml", price: 2300, available: false }] },
    ],
  },
  {
    owner: "espiga",
    name: "Panadería La Espiga",
    legalName: "La Espiga SRL",
    taxBase: "3071000006",
    rubro: "gastronomia",
    city: "tostado",
    status: "APPROVED",
    phone: "3491 470600",
    branch: {
      name: "La Espiga",
      address: "Sarmiento 220",
      pickup: true,
      delivery: false,
      hours: [
        [[1, 2, 3, 4, 5, 6], "07:00", "12:30"],
        [[1, 2, 3, 4, 5, 6], "17:00", "20:30"],
        [[0], "08:00", "12:00"],
      ],
    },
    sections: [
      {
        name: "Facturas",
        products: [
          { name: "Medialunas", price: 900, variants: [["Unidad", 900], ["Media docena", 5000], ["Docena", 9500]], groups: [{ name: "Tipo", min: 1, max: 1, options: [["De manteca", 0], ["De grasa", 0]] }] },
          { name: "Facturas surtidas (docena)", price: 9800 },
        ],
      },
      { name: "Panes", products: [{ name: "Pan francés (1 kg)", price: 2800 }, { name: "Chipá (1/4 kg)", price: 3500 }] },
    ],
  },
  {
    owner: "marta",
    name: "Tortas de Marta",
    legalName: "Marta Benítez",
    taxBase: "2729000007",
    rubro: "emprendedores",
    city: "tostado",
    status: "APPROVED",
    phone: "3491 480700",
    branch: {
      name: "Casa de Marta",
      address: "Pasaje Los Aromos 12",
      notes: "Retiro coordinando por teléfono",
      pickup: true,
      delivery: false,
      // Solo fines de semana: sirve para ver un comercio cerrado entre semana.
      hours: [[[0, 6], "10:00", "19:00"]],
    },
    sections: [
      {
        name: "Tortas",
        products: [
          { name: "Chocotorta", price: 18000, variants: [["Chica (8 porciones)", 18000], ["Grande (16 porciones)", 32000]] },
          { name: "Lemon pie", price: 19500 },
          { name: "Brownie con merengue", price: 16000 },
        ],
      },
    ],
  },
  {
    owner: "gaucho",
    name: "Rotisería El Gaucho",
    legalName: "Raúl Acosta",
    taxBase: "2022000008",
    rubro: "gastronomia",
    city: "tostado",
    status: "PENDING_REVIEW",
    phone: "3491 490800",
    branch: {
      name: "El Gaucho",
      address: "Rivadavia 900",
      pickup: true,
      delivery: false,
      hours: [[WEEKDAYS, "11:00", "14:30"]],
    },
    sections: [{ name: "Minutas", products: [{ name: "Milanesa con papas", price: 11000 }, { name: "Pollo al spiedo (1/2)", price: 9000 }] }],
  },
  {
    owner: "rosa",
    name: "Verdulería Doña Rosa",
    legalName: "Rosa Medina",
    taxBase: "2731000009",
    rubro: "supermercados",
    city: "tostado",
    status: "DRAFT",
    phone: "3491 400900",
  },
  {
    owner: "cafecentral",
    name: "Café Central Gálvez",
    legalName: "Café Central SA",
    taxBase: "3071000010",
    rubro: "gastronomia",
    city: "galvez",
    status: "APPROVED",
    phone: "3404 480100",
    branch: {
      name: "Central",
      address: "Av. Belgrano 450",
      pickup: true,
      delivery: false,
      hours: [[EVERY_DAY, "07:00", "23:00"]],
    },
    sections: [
      {
        name: "Cafetería",
        products: [
          { name: "Café con leche", price: 2900, variants: [["Chico", 2500], ["Grande", 3300]] },
          { name: "Tostado de jamón y queso", price: 5200 },
          { name: "Medialunas (x3)", price: 2700 },
        ],
      },
    ],
  },
];

/** Pedidos de ejemplo para el tablero del comercio "esquina". */
export const DEMO_ORDERS: Array<{
  key: string;
  customer: [string, string];
  delivery?: { zone: string; address: string; notes?: string };
  items: Array<{ product: string; variant?: string; options?: Array<[string, number]>; quantity: number; notes?: string }>;
  /** Estados a los que se avanza después de crearlo. */
  advance: string[];
}> = [
  {
    key: "demo-esquina-1",
    customer: ["Ana Gómez", "3491 555 123"],
    delivery: { zone: "Centro", address: "Belgrano 456", notes: "Timbre B" },
    items: [
      { product: "Muzzarella", variant: "Grande (8 porciones)", options: [["Común", 1], ["Extra muzzarella", 1]], quantity: 1, notes: "Bien cocida" },
      { product: "Coca-Cola 1,5 L", quantity: 1 },
    ],
    advance: [],
  },
  {
    key: "demo-esquina-2",
    customer: ["Juan Pérez", "3491 555 234"],
    items: [{ product: "Carne cortada a cuchillo", variant: "Docena", options: [["Al horno", 1]], quantity: 1 }],
    advance: ["ACCEPTED", "PREPARING"],
  },
  {
    key: "demo-esquina-3",
    customer: ["Lucía Fernández", "3491 555 345"],
    delivery: { zone: "Barrio Norte", address: "Los Ceibos 1530" },
    items: [
      { product: "Napolitana", variant: "Grande (8 porciones)", options: [["Integral", 1]], quantity: 1 },
      { product: "Humita", variant: "Media docena", quantity: 1 },
    ],
    advance: ["ACCEPTED", "PREPARING", "READY"],
  },
  {
    key: "demo-esquina-4",
    customer: ["Martín Ruiz", "3491 555 456"],
    items: [{ product: "Fugazzeta rellena", options: [["Común", 1]], quantity: 1 }],
    advance: ["ACCEPTED", "PREPARING", "READY", "PICKED_UP"],
  },
];
