/**
 * Receipt & Invoicing Utilities for BTA Business Transform Africa
 * Supports 80mm Thermal Receipt, A4 Invoice, WhatsApp message generation and print triggers
 */

import { Sale, CompanySettings, DebtRecord } from '../types';
import { formatUSD, formatCDF, formatDateLubumbashi } from './currency';

export function generateWhatsAppSaleText(sale: Sale, settings: CompanySettings): string {
  const lines: string[] = [
    `🧾 *${settings.companyName.toUpperCase()}*`,
    `📍 ${settings.address}, ${settings.city}`,
    `📞 Tél: ${settings.phone}`,
    `--------------------------------`,
    `*FACTURE N°: ${sale.invoiceNumber}*`,
    `📅 Date: ${formatDateLubumbashi(sale.date)}`,
    `👤 Client: ${sale.customerName}`,
    `💳 Mode: ${getPaymentMethodLabel(sale.paymentMethod)}`,
    `--------------------------------`,
    `*ARTICLES:*`,
  ];

  sale.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.productName}\n   ${item.quantity} x ${formatUSD(item.unitPriceUSD)} = *${formatUSD(item.totalUSD)}*`
    );
  });

  lines.push(`--------------------------------`);
  if (sale.discountUSD > 0) {
    lines.push(`Sous-total: ${formatUSD(sale.subtotalUSD)}`);
    lines.push(`Remise: -${formatUSD(sale.discountUSD)}`);
  }
  lines.push(`*TOTAL À PAYER: ${formatUSD(sale.totalUSD)}*`);
  lines.push(`*Équivalent en Francs: ${formatCDF(sale.totalCDF)}*`);
  lines.push(`Taux appliqué: 1 USD = ${sale.exchangeRate} FC`);

  if (sale.debtAmountUSD > 0) {
    lines.push(`Montant payé: ${formatUSD(sale.amountPaidUSD)}`);
    lines.push(`⚠️ *Reste à payer (Dette): ${formatUSD(sale.debtAmountUSD)}*`);
  }

  lines.push(`--------------------------------`);
  lines.push(`_Caissier: ${sale.cashierName}_`);
  lines.push(`_${settings.footerMessage}_`);

  return encodeURIComponent(lines.join('\n'));
}

export function generateWhatsAppDebtReceiptText(
  debt: DebtRecord,
  paidUSD: number,
  receiptNumber: string,
  settings: CompanySettings
): string {
  const lines: string[] = [
    `🧾 *${settings.companyName.toUpperCase()}*`,
    `*REÇU DE REMBOURSEMENT DE DETTE*`,
    `N°: ${receiptNumber}`,
    `--------------------------------`,
    `👤 Bénéficiaire: ${debt.partyName}`,
    `Ref. Facture: ${debt.referenceInvoice}`,
    `📅 Date: ${formatDateLubumbashi(new Date().toISOString())}`,
    `--------------------------------`,
    `Montant versé: *${formatUSD(paidUSD)}* (${formatCDF(paidUSD * settings.exchangeRate)})`,
    `Nouveau Solde Restant: *${formatUSD(debt.remainingBalanceUSD)}*`,
    `--------------------------------`,
    `_${settings.footerMessage}_`,
  ];
  return encodeURIComponent(lines.join('\n'));
}

export function getPaymentMethodLabel(method: string): string {
  switch (method) {
    case 'CASH':
      return 'Espèces (Cash)';
    case 'MOBILE_MONEY':
      return 'Mobile Money (M-Pesa / Airtel / Orange)';
    case 'BANK_TRANSFER':
      return 'Virement Bancaire';
    case 'CREDIT':
      return 'À Crédit (Dette 100%)';
    case 'PARTIAL':
      return 'Paiement Partiel (Acompte + Dette)';
    default:
      return method;
  }
}
