export type UserRole = 'ADMIN' | 'GESTIONNAIRE' | 'CASHIER';

export interface User {
  id: string;
  name: string;
  email: string;
firebaseUid?: string; // Identifiant du compte Firebase associé
  role: UserRole;
  phone: string;
  active: boolean;
  avatar?: string;
  pinHash?: string; // SHA-256 hashed PIN
  pinSalt?: string; // Cryptographic salt
}

export type UnitOfMeasure = 'pcs' | 'kg' | 'm' | 'sac' | 'carton' | 'litre' | 'paquet' | 'bidon' | 'bouteille' | 'seau';

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
  currency?: 'USD' | 'CDF';
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
  createdById?: string;
  createdByName?: string;
  authenticatedActorUid?: string;
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
  createdById?: string;
  authenticatedActorUid?: string;
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
  /** Logo d'entreprise compressé (data URL JPEG), synchronisé avec les paramètres du tenant. */
  logoDataUrl?: string;
  /** Couleur de marque utilisée sur les reçus et éléments de profil. */
  brandColor?: string;
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
  syncProgress?: { collection: string; recovered: number; phase: 'PULL' };
}
// ==========================================
// RESERVATIONS CLIENTS ET LIVRAISONS
// ==========================================

 export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PARTIALLY_DELIVERED'
  | 'DELIVERED'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED';

export type ReservationStockPolicy =
  | 'BLOCK_STOCK'
  | 'BLOCK_ON_DELIVERY';

export interface ReservationItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantityReserved: number;
  quantityDelivered: number;
  unit: UnitOfMeasure;
  unitPriceUSD: number;
  totalUSD: number;
  stockPolicy: ReservationStockPolicy;
}
export interface Reservation {
  id: string;
  reservationNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  items: ReservationItem[];
  totalUSD: number;
  totalCDF: number;
  exchangeRate: number;
  amountPaidUSD: number;
  remainingAmountUSD: number;
  status: ReservationStatus;
  reservationDate: string;
  expectedDeliveryDate?: string;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}
export interface ReservationCancellation {
  id: string;
  reservationId: string;
  reservationNumber: string;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  status: 'PENDING' | 'DECIDED';
  decision?: 'REFUND_FULL' | 'REFUND_PARTIAL' | 'RETAIN_FULL' | 'RETAIN_PARTIAL';
  amountPaidUSD: number;
  amountRefundedUSD?: number;
  amountRetainedUSD?: number;
  decisionReason?: string;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
}
export interface ReservationPayment {
  id: string;
  reservationId: string;
  reservationNumber: string;
  amountUSD: number;
  amountCDF: number;
  exchangeRate: number;
  paymentMethod: PaymentMethod;
  receiptNumber: string;
  paymentDate: string;
  recordedBy: string;
  notes?: string;
}

export interface ReservationDeliveryItem {
  reservationItemId: string;
  productId: string;
  productName: string;
  quantityDelivered: number;
  unit: UnitOfMeasure;
}

export interface ReservationDelivery {
  id: string;
  deliveryNumber: string;
  reservationId: string;
  reservationNumber: string;
  customerId: string;
  customerName: string;
  items: ReservationDeliveryItem[];
  deliveryDate: string;
  deliveredBy: string;
  deliveredByName: string;
  notes?: string;
}

// ==========================================
// PRODUITS ENDOMMAGES ET PERTES
// ==========================================

export type StockDamageStatus =
  | 'RECOVERABLE'
  | 'UNSELLABLE'
  | 'RETURN_TO_SUPPLIER'
  | 'DISCOUNT_RESALE'
  | 'WRITTEN_OFF';

export interface StockDamage {
  id: string;
  damageNumber: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: UnitOfMeasure;
  status: StockDamageStatus;
  estimatedLossUSD: number;
  description: string;
  supplierId?: string;
  supplierName?: string;
  date: string;
  recordedBy: string;
  recordedByName: string;
  notes?: string;
}

// ==========================================
// SORTIES GRATUITES DE STOCK
// ==========================================

export interface FreeIssue {
  id: string;
  issueNumber: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: UnitOfMeasure;
  estimatedValueUSD: number;
  beneficiary: string;
  reason: string;
  date: string;
  issuedBy: string;
  issuedByName: string;
  notes?: string;
}

// ==========================================
// BTA CARGO TRACKING MODULE
// ==========================================

export type CargoStatus =
  | 'REGISTERED'          // 1. Colis enregistré
  | 'CHINA_WAREHOUSE'     // 2. Arrivé à l'entrepôt en Chine
  | 'PREPARING'           // 3. En préparation
  | 'SHIPPED_CHINA'       // 4. Expédié depuis la Chine
  | 'INTERNATIONAL_TRANSIT' // 5. En transit international
  | 'TRANSIT_COUNTRY'     // 6. Arrivé dans un pays de transit
  | 'CUSTOMS'             // 7. En douane
  | 'ARRIVED_DRC'         // 8. Arrivé en RDC
  | 'ON_WAY_BUNIA'        // 9. En route vers Bunia
  | 'ARRIVED_BUNIA'       // 10. Arrivé à Bunia
  | 'AVAILABLE_PICKUP'    // 11. Disponible pour retrait
  | 'DELIVERED';          // 12. Livré au client

export type TransportMode = 'AIR' | 'SEA';

export interface CargoEvent {
  id: string;
  packageId: string;
  status: CargoStatus;
  country: string;
  city: string;
  location?: string;
  date: string;
  comment: string;
  photoUrl?: string;
  documentUrl?: string;
  recordedBy: string;
  recordedByName: string;
}

export interface CargoPayment {
  id: string;
  packageId: string;
  amountUSD: number;
  amountCDF: number;
  exchangeRate: number;
  paymentMethod: PaymentMethod;
  receiptNumber: string;
  date: string;
  recordedBy: string;
  notes?: string;
}

export interface CargoPackage {
  id: string;
  packingNumber: string; // Numéro PKG réel fourni et inscrit par le fournisseur sur le colis
  customerId?: string;
  customerName: string;
  customerPhone: string;
  supplierName: string;
  description: string;
  originCountry: string;
  originCity: string;
  destinationCountry: string;
  destinationCity: string; // Default 'Bunia'
  transportMode: TransportMode;
  carrierName: string;
  registrationDate: string;
  expectedShippingDate?: string;
  piecesCount: number;
  weightKg: number;
  volumeCbm: number;
  /** Prix appliqué selon le transport : USD/kg en aérien, USD/CBM en maritime. Absent sur les anciens colis. */
  unitPriceUSD?: number;
  photos: string[];
  documents: string[];
  currentStatus: CargoStatus;
  initialCostUSD: number;
  transportFeeUSD: number;
  customsFeeUSD: number;
  extraFeeUSD: number;
  totalAmountUSD: number;
  amountPaidUSD: number;
  remainingBalanceUSD: number;
  currency: 'USD' | 'CDF';
  exchangeRate: number;
  events: CargoEvent[];
  payments: CargoPayment[];
  createdById: string;
  createdByName: string;
  syncStatus: 'SYNCED' | 'PENDING' | 'ERROR';
}
