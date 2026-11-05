import {
  Category,
  Product,
  Customer,
  Supplier,
  Sale,
  Purchase,
  StockMovement,
  Expense,
  CompanySettings,
  User,
  DebtRecord,
} from '../types';

export const INITIAL_SETTINGS: CompanySettings = {
  companyName: 'BTA Business Transform Africa',
  slogan: 'Commerce Général & Quincaillerie Moderne',
  address: '345 Avenue Kilela Balanda, Q. Makutano',
  city: 'Lubumbashi, Haut-Katanga (RDC)',
  phone: '+243 82 000 1234 / +243 99 888 5678',
  email: 'contact@bta-africa.com',
  rccm: 'CD/LSH/RCCM/22-B-01458',
  idNat: '01-83-N45209K',
  nif: 'A1804291L',
  primaryCurrency: 'USD',
  exchangeRate: 2800, // 1 USD = 2800 CDF
  timezone: 'Africa/Lubumbashi',
  receiptPrinterType: 'THERMAL_80MM',
  footerMessage: 'Merci pour votre confiance. Les marchandises vendues ne sont ni reprises ni échangées après 48h.',
  autoLogoutMinutes: 15,
};

export const INITIAL_USERS: User[] = [
  {
    id: 'user-admin-1',
    name: 'Georges',
    email: 'admin@bta-africa.com',
    role: 'ADMIN',
    phone: '+243 81 234 5678',
    active: true,
    pinSalt: 'salt_bta_admin_01',
    pinHash: 'e0b97a9fd498200f6c4142ea3659889ac3616ab1c8a86293e3be2c048e02d360', // PIN: 9999
  },
  {
    id: 'user-mgr-1',
    name: 'Didier',
    email: 'gestion@bta-africa.com',
    role: 'GESTIONNAIRE',
    phone: '+243 97 456 7890',
    active: true,
    pinSalt: 'salt_bta_mgr_02',
    pinHash: '804f3ab4f43fb423a58dd636ba84e2147fab4c741076ea65c3c37044a8883686', // PIN: 5555
  },
  {
    id: 'user-cash-1',
    name: 'Mylet',
    email: 'caisse@bta-africa.com',
    role: 'CAISSIER',
    phone: '+243 85 111 2233',
    active: true,
    pinSalt: 'salt_bta_cash_03',
    pinHash: '0de2973c670ae6df148c5cfeca35a16d71263f743d195ae9c0e2ee6ad822ed7d', // PIN: 1234
  },
];

export const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'cat-produits-bta',
    name: 'Produits BTA',
    description: 'Produits commerciaux de BTA',
    iconName: 'Package',
    color: '#0284C7',
  },
];

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-kaounga',
    sku: 'BTA-PROD-001',
    barcode: '',
    name: 'Kaounga',
    description: 'Stock initial BTA',
    categoryId: 'cat-produits-bta',
    categoryName: 'Produits BTA',
    brand: 'BTA',
    photoUrl: '',
    buyPriceUSD: 0,
    sellPriceUSD: 0,
    currentStock: 3000,
    minStock: 0,
    unit: 'sac',
    variants: [],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  },
  {
    id: 'prod-riz',
    sku: 'BTA-PROD-002',
    barcode: '',
    name: 'Riz',
    description: 'Stock initial BTA',
    categoryId: 'cat-produits-bta',
    categoryName: 'Produits BTA',
    brand: 'BTA',
    photoUrl: '',
    buyPriceUSD: 0,
    sellPriceUSD: 0,
    currentStock: 1000,
    minStock: 0,
    unit: 'sac',
    variants: [],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  },
  {
    id: 'prod-huile',
    sku: 'BTA-PROD-003',
    barcode: '',
    name: 'Huile',
    description: 'Stock initial BTA',
    categoryId: 'cat-produits-bta',
    categoryName: 'Produits BTA',
    brand: 'BTA',
    photoUrl: '',
    buyPriceUSD: 0,
    sellPriceUSD: 0,
    currentStock: 800,
    minStock: 0,
    unit: 'bidon',
    variants: [],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  },
  {
    id: 'prod-savon-dawa',
    sku: 'BTA-PROD-004',
    barcode: '',
    name: 'Savon Dawa',
    description: 'Stock initial BTA',
    categoryId: 'cat-produits-bta',
    categoryName: 'Produits BTA',
    brand: 'BTA',
    photoUrl: '',
    buyPriceUSD: 0,
    sellPriceUSD: 0,
    currentStock: 10000,
    minStock: 0,
    unit: 'pcs',
    variants: [],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  },
  {
    id: 'prod-mafuta-dawa',
    sku: 'BTA-PROD-005',
    barcode: '',
    name: 'Mafuta Dawa',
    description: 'Stock initial BTA',
    categoryId: 'cat-produits-bta',
    categoryName: 'Produits BTA',
    brand: 'BTA',
    photoUrl: '',
    buyPriceUSD: 0,
    sellPriceUSD: 0,
    currentStock: 160,
    minStock: 0,
    unit: 'bouteille',
    variants: [],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  },
  {
    id: 'prod-pommade-dawa',
    sku: 'BTA-PROD-006',
    barcode: '',
    name: 'Pommade Dawa',
    description: 'Stock initial BTA',
    categoryId: 'cat-produits-bta',
    categoryName: 'Produits BTA',
    brand: 'BTA',
    photoUrl: '',
    buyPriceUSD: 0,
    sellPriceUSD: 0,
    currentStock: 7,
    minStock: 0,
    unit: 'seau',
    variants: [],
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  },
];

export const INITIAL_CUSTOMERS: Customer[] = [];

export const INITIAL_SUPPLIERS: Supplier[] = [];

export const INITIAL_SALES: Sale[] = [];

export const INITIAL_PURCHASES: Purchase[] = [];

export const INITIAL_STOCK_MOVEMENTS: StockMovement[] = [];

export const INITIAL_EXPENSES: Expense[] = [];

export const INITIAL_DEBTS: DebtRecord[] = [];
