import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Saves a text file and hands it to the user.
 * - Android app : writes to the app cache and opens the system share sheet
 *                 (Drive, WhatsApp, e-mail, "Enregistrer dans Fichiers"...)
 *                 because <a download> / blob: URLs do not work inside an Android WebView.
 * - Browser     : classic download.
 */
export async function saveTextFile(filename: string, content: string, mime = 'text/plain'): Promise<void> {
  const safeName = filename.replace(/[^\w.\-]+/g, '_');

  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({
      path: safeName,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: safeName,
      dialogTitle: 'Enregistrer / envoyer le fichier',
      url: written.uri,
    });
    return;
  }

  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Escapes one CSV cell and neutralises spreadsheet formula injection (=, +, -, @). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Builds a WhatsApp-compatible international number (default country: RDC +243). */
export function toWhatsAppNumber(raw: string, defaultCountryCode = '243'): string {
  let d = (raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return defaultCountryCode + d.slice(1);
  if (d.length <= 9) return defaultCountryCode + d;
  return d;
}
