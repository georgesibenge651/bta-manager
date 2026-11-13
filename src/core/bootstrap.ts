import type { Category, Customer, Product, StockMovement, Supplier, UnitOfMeasure } from '../types';
import {
  coreCategories, coreCustomers, coreDebts, coreProducts, coreStock, coreStockMovements, coreSuppliers,
} from './api';

export interface CoreBootstrapSnapshot {
  tenantId: number;
  branchId: number;
  downloadedAt: string;
  categories: Category[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  stockMovements: StockMovement[];
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const str = (value: unknown, fallback = '') => typeof value === 'string' ? value : value == null ? fallback : String(value);
const localId = (kind: string, id: unknown) => `core-${kind}-${String(id)}`;
const units: UnitOfMeasure[] = ['pcs','kg','m','sac','carton','litre','paquet','bidon','bouteille','seau'];
function unitOf(value: unknown): UnitOfMeasure {
  const normalized = str(value).toLowerCase();
  if (normalized === 'piece' || normalized === 'pieces' || normalized === 'unit') return 'pcs';
  return units.includes(normalized as UnitOfMeasure) ? normalized as UnitOfMeasure : 'pcs';
}

async function allPages<T>(read: (page: number) => Promise<{ pagination?: unknown } & Record<string, unknown>>, key: string): Promise<T[]> {
  const output: T[] = [];
  for (let page = 1; page <= 10000; page += 1) {
    const response = await read(page);
    const rows = response[key];
    if (!Array.isArray(rows)) throw new Error(`Réponse Core invalide : ${key} absent.`);
    output.push(...rows as T[]);
    const pagination = asRecord(response.pagination);
    const pages = num(pagination.pages, 1);
    if (page >= pages || rows.length === 0) return output;
  }
  throw new Error(`Pagination Core anormale pour ${key}.`);
}

async function allCursorPages(read: (cursor?: string) => Promise<{ items: Array<Record<string, unknown>>; has_more: boolean; next_cursor: string | null }>): Promise<Array<Record<string, unknown>>> {
  const output: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10000; page += 1) {
    const response = await read(cursor);
    if (!Array.isArray(response.items)) throw new Error('Réponse sync/pull Core invalide.');
    output.push(...response.items);
    if (!response.has_more) return output;
    if (!response.next_cursor || response.next_cursor === cursor) throw new Error('Curseur Core invalide ou répétitif.');
    cursor = response.next_cursor;
  }
  throw new Error('Pagination par curseur Core anormale.');
}

export async function fetchCoreBootstrap(tenantId: number, branchId: number, usdToCdfRate: number, permissions: string[]): Promise<CoreBootstrapSnapshot> {
  const [categoryRows, productRows, customerResponse, supplierResponse, debtResponse, stockRows, movementRows] = await Promise.all([
    allPages<Record<string, unknown>>(page => coreCategories(tenantId, branchId, page), 'categories'),
    allPages<Record<string, unknown>>(page => coreProducts(tenantId, branchId, page), 'products'),
    permissions.includes('customers.read') ? allPages<Record<string,unknown>>(page => coreCustomers(tenantId, branchId, page), 'customers').then(customers => ({success:true as const,customers})) : Promise.resolve({success:true as const,customers:[]}),
    permissions.includes('suppliers.read') && permissions.includes('purchases.read') ? allPages<Record<string,unknown>>(page => coreSuppliers(tenantId, branchId, page), 'suppliers').then(suppliers => ({success:true as const,suppliers})) : Promise.resolve({success:true as const,suppliers:[]}),
    permissions.includes('debts.read') ? allPages<Record<string,unknown>>(page => coreDebts(tenantId, branchId, page), 'debts').then(debts => ({success:true as const,debts})) : Promise.resolve({success:true as const,debts:[]}),
    allCursorPages(cursor => coreStock(tenantId, branchId, cursor)),
    allCursorPages(cursor => coreStockMovements(tenantId, branchId, cursor)),
  ]);
  if (![customerResponse.customers, supplierResponse.suppliers, debtResponse.debts].every(Array.isArray)) {
    throw new Error('Core n’a pas renvoyé les listes de clients, fournisseurs ou dettes attendues.');
  }

  const categories = categoryRows.map(row => ({
    id: localId('category', row.id), name: str(row.name), description: str(row.description), iconName: 'Folder', color: '#0284C7',
  })).filter(item => item.name);
  const categoryNames = new Map(categories.map(item => [item.id, item.name]));
  const stockByProduct = new Map<number, number>();
  for (const row of stockRows) stockByProduct.set(num(row.product_id), num(row.quantity));
  const rate = usdToCdfRate > 0 ? usdToCdfRate : 2800;
  const toUsd = (amount: unknown, currency: unknown) => num(amount) / (str(currency, 'USD').toUpperCase() === 'CDF' ? rate : 1);
  const products: Product[] = productRows.map(row => {
    const id = num(row.id);
    const categoryId = row.category_id ? localId('category', row.category_id) : '';
    return {
      id: localId('product', id), sku: str(row.sku), barcode: str(row.barcode), name: str(row.name), description: str(row.description),
      categoryId, categoryName: categoryNames.get(categoryId) ?? 'Divers', brand: '', photoUrl: str(row.image_url),
      buyPriceUSD: toUsd(row.purchase_price, row.currency), sellPriceUSD: toUsd(row.sale_price, row.currency),
      currentStock: stockByProduct.get(id) ?? 0, minStock: num(row.min_stock), unit: unitOf(row.unit), variants: [],
      createdAt: str(row.created_at, new Date().toISOString()), updatedAt: str(row.updated_at, new Date().toISOString()),
    };
  }).filter(product => product.name);
  const debtByCustomer = new Map<number, number>();
  for (const row of debtResponse.debts as Array<Record<string, unknown>>) {
    const customerId = num(row.customer_id);
    if (customerId) debtByCustomer.set(customerId, (debtByCustomer.get(customerId) ?? 0) + toUsd(row.balance, row.currency));
  }
  const customers: Customer[] = (customerResponse.customers as Array<Record<string, unknown>>).map(row => ({
    id: localId('customer', row.id), name: str(row.name), phone: str(row.phone), address: str(row.address), email: str(row.email), city: '',
    debtBalanceUSD: debtByCustomer.get(num(row.id)) ?? 0, creditLimitUSD: num(row.credit_limit), registeredAt: str(row.created_at, new Date().toISOString()),
    ...(row.notes ? { notes: str(row.notes) } : {}),
  })).filter(customer => customer.name);
  const suppliers: Supplier[] = (supplierResponse.suppliers as Array<Record<string, unknown>>).map(row => ({
    id: localId('supplier', row.id), companyName: str(row.name), contactName: '', phone: str(row.phone), address: str(row.address), email: str(row.email),
    suppliedProducts: str(row.notes), balanceDueUSD: 0, registeredAt: str(row.created_at, new Date().toISOString()),
  })).filter(supplier => supplier.companyName);
  const productByServerId = new Map(productRows.map(row => [num(row.id), str(row.name)]));
  const stockMovements: StockMovement[] = movementRows.map(row => {
    const quantity = num(row.quantity);
    const rawType = str(row.movement_type).toUpperCase();
    const type: StockMovement['type'] = rawType.includes('SALE') ? 'SALE' : rawType.includes('PURCHASE') || rawType.includes('RECEIPT') ? 'PURCHASE' : rawType.includes('RETURN') ? 'RETURN_CUSTOMER' : rawType.includes('DAMAGE') || rawType.includes('LOSS') ? 'LOSS_DAMAGE' : 'ADJUSTMENT';
    return {
      id: localId('movement', row.id), productId: localId('product', row.product_id), productName: productByServerId.get(num(row.product_id)) ?? '',
      quantity, type, date: str(row.created_at, new Date().toISOString()), userId: str(row.created_by), userName: '', reason: str(row.notes),
      referenceNumber: str(row.reference_id), previousStock: 0, newStock: quantity,
    };
  });
  return { tenantId, branchId, downloadedAt: new Date().toISOString(), categories, products, customers, suppliers, stockMovements };
}
