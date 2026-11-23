/**
 * Currency and Date utilities for CHIEF ALPHONS COMPANY LTD
 * Handles USD and Congolese Franc (CDF) conversions and formatting.
 */

export function formatUSD(amount: number): string {
  const safe = isNaN(amount) ? 0 : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatCDF(amount: number): string {
  const safe = isNaN(amount) ? 0 : Math.round(amount);
  return new Intl.NumberFormat('fr-CD', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safe) + ' FC';
}

/**
 * Converts USD to CDF using specific rate
 */
export function usdToCdf(amountUSD: number, exchangeRate: number): number {
  return Math.round((amountUSD || 0) * (exchangeRate || 2800));
}

/**
 * Converts CDF to USD using specific rate
 */
export function cdfToUsd(amountCDF: number, exchangeRate: number): number {
  if (!exchangeRate || exchangeRate <= 0) return 0;
  return Number(((amountCDF || 0) / exchangeRate).toFixed(2));
}

/**
 * Displays both currencies side by side
 * e.g. "$45.00 (126,000 FC)"
 */
export function formatDual(amountUSD: number, exchangeRate: number, primary: 'USD' | 'CDF' = 'USD'): string {
  const usd = formatUSD(amountUSD);
  const cdf = formatCDF(usdToCdf(amountUSD, exchangeRate));
  if (primary === 'CDF') {
    return `${cdf} (${usd})`;
  }
  return `${usd} (${cdf})`;
}

/**
 * Format date for Africa/Lubumbashi timezone (GMT+2)
 */
export function formatDateLubumbashi(dateInput: string | Date | number, includeTime = true): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'Date invalide';
    
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'Africa/Lubumbashi',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    };
    return new Intl.DateTimeFormat('fr-FR', options).format(d);
  } catch {
    return new Date(dateInput).toLocaleString('fr-FR');
  }
}

/**
 * Generate unique business ID with prefix and timestamp
 * e.g., FAC-202611-9238
 */
export function generateReferenceNumber(prefix: string): string {
  const d = new Date();
  const yearMonth = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${yearMonth}-${random}`;
}

/**
 * UUID v4 generator for local Room/IndexedDB persistence
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
