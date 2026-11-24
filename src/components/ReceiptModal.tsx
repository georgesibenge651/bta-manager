import { toWhatsAppNumber } from '../utils/files';
import React, { useState } from 'react';
import { X, Printer, Share2, FileText, CheckCircle2 } from 'lucide-react';
import { Sale, CompanySettings, DebtRecord } from '../types';
import { formatUSD, formatCDF, formatDateLubumbashi } from '../utils/currency';
import { generateWhatsAppSaleText, generateWhatsAppDebtReceiptText } from '../utils/receipt';
import { useLanguage } from '../i18n';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale?: Sale;
  debtRecord?: DebtRecord;
  debtRepaymentAmountUSD?: number;
  debtReceiptNumber?: string;
  settings: CompanySettings;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  sale,
  debtRecord,
  debtRepaymentAmountUSD,
  debtReceiptNumber,
  settings,
}) => {
  const { language, t } = useLanguage();
  const paymentMethodLabel = (method: string) => {
    switch (method) {
      case 'CASH': return t('Espèces (Cash)', 'Cash');
      case 'MOBILE_MONEY': return t('Mobile Money (M-Pesa / Airtel / Orange)', 'Mobile Money (M-Pesa / Airtel / Orange)');
      case 'BANK_TRANSFER': return t('Virement Bancaire', 'Bank transfer');
      case 'CREDIT': return t('À Crédit (Dette 100%)', 'On credit (100% debt)');
      case 'PARTIAL': return t('Paiement Partiel (Acompte + Dette)', 'Partial payment (deposit + balance due)');
      default: return method;
    }
  };
  const [format, setFormat] = useState<'80MM' | 'A4'>('80MM');
  const [copySuccess, setCopySuccess] = useState(false);

  if (!isOpen) return null;

  const isSale = !!sale;

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsApp = () => {
    let text = '';
    if (isSale && sale) {
      text = generateWhatsAppSaleText(sale, settings);
    } else if (debtRecord && debtRepaymentAmountUSD && debtReceiptNumber) {
      text = generateWhatsAppDebtReceiptText(debtRecord, debtRepaymentAmountUSD, debtReceiptNumber, settings);
    }
    const phone = toWhatsAppNumber(sale?.customerPhone || debtRecord?.partyPhone || '');
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
  };

  const handleCopyText = () => {
    let text = '';
    if (isSale && sale) {
      text = decodeURIComponent(generateWhatsAppSaleText(sale, settings));
    } else if (debtRecord && debtRepaymentAmountUSD && debtReceiptNumber) {
      text = decodeURIComponent(generateWhatsAppDebtReceiptText(debtRecord, debtRepaymentAmountUSD, debtReceiptNumber, settings));
    }
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      })
      .catch(() => alert(t('Copie impossible sur cet appareil.', 'Copying is not available on this device.')));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl border border-slate-200 my-auto flex flex-col max-h-[92vh]">
        {/* Modal Toolbar (hidden during print) */}
        <div className="bg-[#0F2444] text-white p-3 sm:p-4 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-sm sm:text-base">
              {isSale ? `${t('Facture N°', 'Invoice #')} ${sale?.invoiceNumber}` : `${t('Reçu de Remboursement N°', 'Refund receipt #')} ${debtReceiptNumber}`}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-800 rounded-xl p-1 text-xs">
              <button
                onClick={() => setFormat('80MM')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  format === '80MM' ? 'bg-amber-500 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                80 mm ({t('Ticket', 'Receipt')})
              </button>
              <button
                onClick={() => setFormat('A4')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  format === 'A4' ? 'bg-amber-500 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                A4 ({t('Standard', 'Standard')})
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Preview Area */}
        <div className="p-4 sm:p-6 overflow-y-auto bg-slate-100 flex-1 flex justify-center">
          {format === '80MM' ? (
            /* 80mm Thermal Receipt Layout */
            <div
              id="printable-receipt"
              className="bg-white text-slate-900 w-[340px] p-5 rounded-2xl shadow-md font-mono text-xs border border-slate-300 leading-tight space-y-3"
            >
              <div className="text-center border-b border-dashed border-slate-400 pb-3">
                {settings.logoDataUrl && <img src={settings.logoDataUrl} alt={t('Logo','Logo')} className="mx-auto mb-2 max-h-14 max-w-28 object-contain" />}
                <h2 className="font-black text-sm uppercase tracking-wide" style={{ color: settings.brandColor || undefined }}>{settings.companyName}</h2>
                <p className="text-[11px] text-slate-600">{settings.slogan}</p>
                <p className="text-[10px] text-slate-500 mt-1">{settings.address}</p>
                <p className="text-[10px] text-slate-500">{settings.city}</p>
                <p className="text-[10px] text-slate-500">{t('Tél:','Phone:')} {settings.phone}</p>
                <p className="text-[9px] text-slate-400 mt-1">
                  RCCM: {settings.rccm} | ID.NAT: {settings.idNat}
                </p>
              </div>

              {isSale && sale ? (
                <>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="font-semibold">{t('FACTURE N°:','INVOICE #:')}</span>
                      <span className="font-bold">{sale.invoiceNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Date:</span>
                      <span>{formatDateLubumbashi(sale.date, true, language === 'en' ? 'en-US' : 'fr-FR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('Client:','Customer:')}</span>
                      <span className="font-semibold text-right">{sale.customerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('Caissier:','Cashier:')}</span>
                      <span>{sale.cashierName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('Paiement:','Payment:')}</span>
                      <span>{paymentMethodLabel(sale.paymentMethod)}</span>
                    </div>
                  </div>

                  <div className="border-t border-b border-dashed border-slate-400 py-2 space-y-2">
                    <div className="grid grid-cols-12 font-bold text-[10px] uppercase text-slate-600">
                      <div className="col-span-6">{t('Désignation','Description')}</div>
                      <div className="col-span-2 text-right">{t('Qté','Qty')}</div>
                      <div className="col-span-4 text-right">{t('Total','Total')}</div>
                    </div>
                    {sale.items.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 text-[11px] items-start">
                        <div className="col-span-6">
                          <p className="font-medium truncate">{item.productName}</p>
                          <p className="text-[9px] text-slate-500">
                            {item.quantity} x {formatUSD(item.unitPriceUSD)}
                          </p>
                        </div>
                        <div className="col-span-2 text-right font-medium">{item.quantity}</div>
                        <div className="col-span-4 text-right font-bold">{formatUSD(item.totalUSD)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1.5 text-[11px] pt-1">
                    {sale.discountUSD > 0 && (
                      <>
                        <div className="flex justify-between">
                          <span>{t('Sous-total:','Subtotal:')}</span>
                          <span>{formatUSD(sale.subtotalUSD)}</span>
                        </div>
                        <div className="flex justify-between text-emerald-700">
                          <span>{t('Remise:','Discount:')}</span>
                          <span>-{formatUSD(sale.discountUSD)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-sm font-black border-t border-slate-300 pt-1.5">
                      <span>{t('TOTAL USD:','TOTAL USD:')}</span>
                      <span>{formatUSD(sale.totalUSD)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-amber-800">
                      <span>{t('TOTAL CDF:','TOTAL CDF:')}</span>
                      <span>{formatCDF(sale.totalCDF)}</span>
                    </div>
                    <p className="text-[9px] text-slate-500 text-right">
                      ({t('Taux appliqué:','Exchange rate:')} 1 USD = {sale.exchangeRate} FC)
                    </p>

                    <div className="border-t border-dotted border-slate-300 pt-1 text-[11px] space-y-1">
                      <div className="flex justify-between">
                        <span>{t('Montant Payé:','Amount paid:')}</span>
                        <span className="font-bold">{formatUSD(sale.amountPaidUSD)}</span>
                      </div>
                      {sale.debtAmountUSD > 0 && (
                        <div className="flex justify-between text-red-600 font-bold bg-red-50 p-1 rounded">
                          <span>{t('Dette Restante:','Outstanding debt:')}</span>
                          <span>{formatUSD(sale.debtAmountUSD)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : debtRecord && debtRepaymentAmountUSD ? (
                /* Debt repayment receipt */
                <div className="space-y-2 text-[11px]">
                  <div className="bg-emerald-50 text-emerald-800 p-2 rounded-lg text-center font-bold">
                    {t('REÇU DE REMBOURSEMENT DE CRÉDIT','CREDIT REPAYMENT RECEIPT')}
                  </div>
                  <div className="flex justify-between">
                    <span>{t('Reçu N°:','Receipt #:')}</span>
                    <span className="font-bold">{debtReceiptNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{formatDateLubumbashi(new Date().toISOString(), true, language === 'en' ? 'en-US' : 'fr-FR')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('Client / Tiers:','Customer / Party:')}</span>
                    <span className="font-bold">{debtRecord.partyName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('Facture Réf.:','Invoice ref.:')}</span>
                    <span>{debtRecord.referenceInvoice}</span>
                  </div>
                  <div className="border-t border-b border-dashed border-slate-400 py-2">
                    <div className="flex justify-between text-sm font-black text-emerald-700">
                      <span>{t('MONTANT VERSÉ:','AMOUNT PAID:')}</span>
                      <span>{formatUSD(debtRepaymentAmountUSD)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-amber-800">
                      <span>{t('Équivalent CDF:','Equivalent in CDF:')}</span>
                      <span>{formatCDF(debtRepaymentAmountUSD * settings.exchangeRate)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between font-bold pt-1">
                    <span>{t('Nouveau Solde Dû:','New balance due:')}</span>
                    <span className={debtRecord.remainingBalanceUSD > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                      {formatUSD(debtRecord.remainingBalanceUSD)}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Barcode & Footer */}
              <div className="text-center pt-3 border-t border-dashed border-slate-400 space-y-1">
                {/* Simulated Barcode */}
                <div className="flex justify-center py-1">
                  <div className="h-9 w-48 bg-[repeating-linear-gradient(90deg,#000_0px,#000_2px,#fff_2px,#fff_5px,#000_5px,#000_8px,#fff_8px,#fff_10px)] opacity-85"></div>
                </div>
                <p className="text-[9px] text-slate-500 font-mono tracking-widest">
                  {sale?.invoiceNumber || debtReceiptNumber}
                </p>
                <p className="text-[10px] text-slate-600 italic px-2">{settings.footerMessage}</p>
                <p className="text-[9px] text-slate-400">CHIEF ALPHONS COMPANY LTD • Lubumbashi</p>
              </div>
            </div>
          ) : (
            /* A4 Full Commercial Invoice Layout */
            <div
              id="printable-receipt"
              className="bg-white text-slate-900 w-full p-8 rounded-2xl shadow-md font-sans text-xs border border-slate-300 leading-normal space-y-6"
            >
              {/* Header */}
              <div className="flex justify-between items-start border-b-2 border-[#0F2444] pb-4">
                <div>
                  <div className="flex items-start gap-3">                  {settings.logoDataUrl && <img src={settings.logoDataUrl} alt={t('Logo','Logo')} className="max-h-20 max-w-28 object-contain" />}<div><h1 className="text-xl font-black" style={{ color: settings.brandColor || "#0F2444" }}>{settings.companyName}</h1>
                  <p className="text-xs text-amber-600 font-semibold">{settings.slogan}</p>
                  <p className="text-slate-500 mt-1">{settings.address}</p>
                  <p className="text-slate-500">{settings.city}</p>
                  <p className="text-slate-500">{t('Tél:','Phone:')} {settings.phone} | {t('Email:','Email:')} {settings.email}</p>
                  <p className="text-slate-400 text-[10px] mt-1">
                    RCCM: {settings.rccm} • ID.NAT: {settings.idNat} • NIF: {settings.nif}
                  </p></div></div>
                </div>
                <div className="text-right">
                  <span className="bg-[#0F2444] text-white px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider inline-block">
                    {isSale ? t('FACTURE COMMERCIALE','SALES INVOICE') : t('REÇU DE CAISSE','CASH RECEIPT')}
                  </span>
                  <p className="text-lg font-black text-slate-900 mt-2">
                    {sale?.invoiceNumber || debtReceiptNumber}
                  </p>
                  <p className="text-slate-500 text-xs">
                    {t('Date:','Date:')} {formatDateLubumbashi(sale?.date || new Date().toISOString(), true, language === 'en' ? 'en-US' : 'fr-FR')}
                  </p>
                  <p className="text-slate-500 text-xs">
                    {t('Taux:','Rate:')} 1 USD = {sale?.exchangeRate || settings.exchangeRate} CDF
                  </p>
                </div>
              </div>

              {/* Customer Box */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('Facturé à :','Billed to:')}</h4>
                  <p className="text-sm font-bold text-slate-900 mt-1">{sale?.customerName || debtRecord?.partyName}</p>
                  <p className="text-slate-600">{sale?.customerPhone || debtRecord?.partyPhone || t('Client Comptoir','Walk-in customer')}</p>
                </div>
                <div className="text-right">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('Émis par :','Issued by:')}</h4>
                  <p className="text-sm font-bold text-slate-900 mt-1">{sale?.cashierName || t('Caisse Centrale CHIEF ALPHONS COMPANY LTD','CHIEF ALPHONS COMPANY LTD Main Register')}</p>
                  <p className="text-slate-600">{t('Mode:','Method:')} {paymentMethodLabel(sale?.paymentMethod || 'CASH')}</p>
                </div>
              </div>

              {/* Items Table */}
              {isSale && sale && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#0F2444] text-white text-[11px]">
                      <tr>
                        <th className="p-2.5">{t('Réf / SKU','Ref / SKU')}</th>
                        <th className="p-2.5">{t('Désignation Produit','Product description')}</th>
                        <th className="p-2.5 text-center">{t('Qté','Qty')}</th>
                        <th className="p-2.5 text-right">{t('Prix Unitaire (USD)','Unit price (USD)')}</th>
                        <th className="p-2.5 text-right">{t('Total (USD)','Total (USD)')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {sale.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-mono text-slate-500">{item.sku}</td>
                          <td className="p-2.5 font-semibold text-slate-800">{item.productName}</td>
                          <td className="p-2.5 text-center">{item.quantity} {item.unit}</td>
                          <td className="p-2.5 text-right">{formatUSD(item.unitPriceUSD)}</td>
                          <td className="p-2.5 text-right font-bold">{formatUSD(item.totalUSD)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Financial Totals */}
              {isSale && sale && (
                <div className="flex justify-end">
                  <div className="w-64 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>{t('Sous-total:','Subtotal:')}</span>
                      <span>{formatUSD(sale.subtotalUSD)}</span>
                    </div>
                    {sale.discountUSD > 0 && (
                      <div className="flex justify-between text-emerald-600 font-medium">
                        <span>{t('Remise:','Discount:')}</span>
                        <span>-{formatUSD(sale.discountUSD)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-black text-[#0F2444] border-t-2 border-slate-900 pt-2">
                      <span>{t('NET À PAYER (USD):','NET AMOUNT DUE (USD):')}</span>
                      <span>{formatUSD(sale.totalUSD)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-amber-700">
                      <span>{t('Montant en CDF:','Amount in CDF:')}</span>
                      <span>{formatCDF(sale.totalCDF)}</span>
                    </div>
                    <div className="border-t border-slate-200 pt-1.5 space-y-1">
                      <div className="flex justify-between text-slate-700">
                        <span>{t('Montant Encaissé:','Amount received:')}</span>
                        <span className="font-semibold">{formatUSD(sale.amountPaidUSD)}</span>
                      </div>
                      {sale.debtAmountUSD > 0 && (
                        <div className="flex justify-between text-red-600 font-bold bg-red-50 p-1.5 rounded">
                          <span>{t('Dette Clientée:','Customer debt:')}</span>
                          <span>{formatUSD(sale.debtAmountUSD)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200">
                <div className="text-center">
                  <p className="text-[11px] text-slate-500 font-medium">{t('Signature du Client','Customer signature')}</p>
                  <div className="mt-8 border-b border-dashed border-slate-400 w-36 mx-auto"></div>
                </div>
                <div className="text-center">
                  <p className="text-[11px] text-slate-500 font-medium">{t('Pour','For')} {settings.companyName}</p>
                  <div className="mt-8 border-b border-dashed border-slate-400 w-36 mx-auto"></div>
                </div>
              </div>

              {/* Footer Note */}
              <p className="text-[10px] text-slate-500 text-center italic border-t border-slate-200 pt-4">
                {settings.footerMessage}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons Toolbar (Hidden during print) */}
        <div className="p-3 sm:p-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0 print:hidden">
          <button
            onClick={handleCopyText}
            className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-300 flex items-center gap-1.5 transition"
          >
            {copySuccess ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <FileText className="w-4 h-4" />}
            {copySuccess ? t('Copié !', 'Copied!') : t('Copier texte', 'Copy text')}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleWhatsApp}
              className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm flex items-center gap-2 transition"
            >
              <Share2 className="w-4 h-4" />
              WhatsApp
            </button>
            <button
              onClick={handlePrint}
              className="px-4 py-2 text-xs font-bold text-white bg-[#0F2444] hover:bg-amber-900 rounded-xl shadow-sm flex items-center gap-2 transition"
            >
              <Printer className="w-4 h-4" />
              {t('Imprimer Facture', 'Print invoice')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
