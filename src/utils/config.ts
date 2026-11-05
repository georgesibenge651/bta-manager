/**
 * Runtime configuration.
 *
 * VITE_API_BASE_URL : URL of the BTA sync server (e.g. https://api.mon-domaine.com).
 *                     When empty the app runs 100% locally (standalone APK): no network
 *                     call is made and nothing is falsely reported as "synchronised".
 */
const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

export const API_BASE: string = raw.trim().replace(/\/+$/, '');
export const SYNC_ENABLED: boolean = API_BASE.length > 0;
/** Optional shared secret (weak protection: it is embedded in the app). */
export const API_KEY: string = ((import.meta.env.VITE_SYNC_API_KEY as string | undefined) || '').trim();
export const IS_DEV: boolean = !!import.meta.env.DEV;
