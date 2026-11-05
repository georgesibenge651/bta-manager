export type UserRole =
  | 'ADMIN'
  | 'ADMINISTRATEUR'
  | 'GESTIONNAIRE'
  | 'MANAGER'
  | 'CAISSIER'
  | 'CASHIER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  active: boolean;
  avatar?: string;
  pinHash?: string; // SHA-256 hashed PIN
  pinSalt?: string; // Cryptographic salt
}

export type UnitOfMeasure = 'pcs' | 'kg' | 'm' | 'sac' | 'carton' | 'litre' | 'paquet';

export interface ProductVariant {
  name: string; // e.g., 'Taille', 'Couleur', 'Modèle'
  value: string; // e.g., 'XL', 'Bleu', 'Standard'
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName?: string;
  brand: string;
  photoUrl: string;
  buyPriceUSD: number;
  sellPriceUSD: number;
  currentStock: number;
  minStock: number;
  unit: UnitOfMeasure;
  variants: ProductVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  iconName: string;
  color: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  email: string;
  city: string;
  debtBalanceUSD: number;
  creditLimitUSD: number;
  registeredAt: string;
  notes?: string;
}

export interface Supplier {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  address: string;
  email: string;
  suppliedProducts: string;
  balanceDueUSD: number;
  registeredAt: string;
}

export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CREDIT' | 'PARTIAL';

export interface SaleItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceUSD: number;
  buyPriceUSD: number;
  totalUSD: number;
  unit: UnitOfMeasure;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  items: SaleItem[];
  subtotalUSD: number;
  discountUSD: number;
  totalUSD: number;
  totalCDF: number;
  exchangeRate: number; // Applied immutable rate
  paymentMethod: PaymentMethod;
  amountPaidUSD: number;
  amountPaidCDF: number;
  debtAmountUSD: number;
  status: 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  cashierId: string;
  cashierName: string;
  notes?: string;
  date: string;
  syncStatus: 'SYNCED' | 'PENDING' | 'ERROR';
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  quantity: number;
  buyPriceUSD: number;
  totalUSD: number;
  unit: UnitOfMeasure;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  subtotalUSD: number;
  additionalFeesUSD: number;
  totalUSD: number;
  totalCDF: number;
  exchangeRate: number;
  paymentMethod: PaymentMethod;
  amountPaidUSD: number;
  debtAmountUSD: number;
  status: 'COMPLETED' | 'DRAFT' | 'PENDING' | 'CANCELLED';
  date: string;
  syncStatus: 'SYNCED' | 'PENDING' | 'ERROR';
}

export type StockMovementType =
  | 'IN'
  | 'OUT'
  | 'SALE'
  | 'PURCHASE'
  | 'RETURN_CUSTOMER'
  | 'RETURN_SUPPLIER'
  | 'ADJUSTMENT'
  | 'LOSS_DAMAGE';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  quantity: number; // positive for entry, negative for exit
  type: StockMovementType;
  date: string;
  userId: string;
  userName: string;
  reason: string;
  referenceNumber: string;
  previousStock: number;
  newStock: number;
}

export type ExpenseCategory =
  | 'TRANSPORT'
  | 'RENT'
  | 'SALARY'
  | 'ELECTRICITY'
  | 'INTERNET'
  | 'MAINTENANCE'
  | 'OTHER';

export interface Expense {
  id: string;
  title: string;
  description: string;
  category: ExpenseCategory;
  amountUSD: number;
  amountCDF: number;
  exchangeRate: number;
  receiptNumber?: string;
  date: string;
  createdBy: string;
  syncStatus: 'SYNCED' | 'PENDING' | 'ERROR';
}

export interface DebtPaymentEntry {
  id: string;
  date: string;
  amountUSD: number;
  amountCDF: number;
  exchangeRate: number;
  paymentMethod: PaymentMethod;
  receiptNumber: string;
  recordedBy: string;
  notes?: string;
}

export interface DebtRecord {
  id: string;
  type: 'CUSTOMER' | 'SUPPLIER';
  partyId: string;
  partyName: string;
  partyPhone: string;
  initialAmountUSD: number;
  paidAmountUSD: number;
  remainingBalanceUSD: number;
  dueDate: string;
  lastPaymentDate?: string;
  history: DebtPaymentEntry[];
  referenceInvoice: string;
}

export interface CompanySettings {
  companyName: string;
  slogan: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  rccm: string; // Registre de Commerce
  idNat: string; // Numéro d'Identification Nationale
  nif: string; // Numéro d'Impôt
  primaryCurrency: 'USD' | 'CDF';
  exchangeRate: number; // e.g., 2800 CDF for 1 USD
  timezone: string; // Africa/Lubumbashi
  receiptPrinterType: 'THERMAL_80MM' | 'A4_STANDARD';
  footerMessage: string;
  autoLogoutMinutes?: number; // Inactivity timeout in minutes (0 = disabled)
}

export interface SyncStatusInfo {
  status: 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNCED' | 'ERROR';
  lastSyncTime: string;
  pendingCount: number;
  errorMessage?: string;
}
