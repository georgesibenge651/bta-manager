/**
 * Sonde réseau TEMPORAIRE v2 (diagnostic uniquement). Aucun secret : faux identifiants, faux jeton.
 */
import { CapacitorHttp } from '@capacitor/core';

type Row = { step: string; result: string };

async function attempt(step: string, url: string, init: RequestInit): Promise<Row> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = init.mode === 'no-cors' ? '(opaque)' : (await r.text().catch(() => '')).slice(0, 70).replace(/\s+/g, ' ');
    return { step, result: `OK HTTP ${r.status} ${Date.now() - t0}ms ${text}` };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { step, result: `ÉCHEC ${err.name ?? 'Error'}: ${err.message ?? e} ${Date.now() - t0}ms` };
  } finally { clearTimeout(timer); }
}

async function attemptNative(step: string, run: () => Promise<{ status: number; data: unknown }>): Promise<Row> {
  const t0 = Date.now();
  try {
    const r = await run();
    return { step, result: `OK HTTP ${r.status} ${Date.now() - t0}ms ${JSON.stringify(r.data).slice(0, 70)}` };
  } catch (e) {
    const err = e as { message?: string };
    return { step, result: `ÉCHEC ${err.message ?? String(e)} ${Date.now() - t0}ms` };
  }
}

export async function runNetProbe(base: string): Promise<string> {
  const fakeToken = '0'.repeat(64);
  const fake = JSON.stringify({ email: 'probe@example.invalid', password: 'probe-invalid' });
  const rows: Row[] = [];
  rows.push(await attempt('A GET /health no-cors', `${base}/health`, { mode: 'no-cors' }));
  rows.push(await attempt('B GET /health cors', `${base}/health`, { headers: { Accept: 'application/json' } }));
  rows.push(await attempt('C POST login text/plain cors', `${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: fake }));
  rows.push(await attempt('C2 POST login text/plain NO-CORS', `${base}/auth/login`, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: fake }));
  rows.push(await attempt('F GET auth/me cors sans en-tête', `${base}/auth/me`, { headers: { Accept: 'application/json' } }));
  rows.push(await attempt('G GET auth/me no-cors', `${base}/auth/me`, { mode: 'no-cors' }));
  rows.push(await attempt('H GET /health cors + Authorization', `${base}/health`, { headers: { Authorization: `Bearer ${fakeToken}` } }));
  rows.push(await attempt('I POST /health text/plain cors', `${base}/health`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }));
  rows.push(await attempt('D POST login JSON cors', `${base}/auth/login`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: fake }));
  rows.push(await attempt('E GET auth/me + Bearer cors', `${base}/auth/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${fakeToken}` } }));
  rows.push(await attemptNative('N1 NATIF POST login JSON', () => CapacitorHttp.post({ url: `${base}/auth/login`, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, data: JSON.parse(fake) })));
  rows.push(await attemptNative('N2 NATIF GET auth/me + Bearer', () => CapacitorHttp.get({ url: `${base}/auth/me`, headers: { Accept: 'application/json', Authorization: `Bearer ${fakeToken}` } })));
  const head = [`origin=${location.origin}`, `online=${navigator.onLine}`, `date=${new Date().toISOString()}`];
  return [...head, ...rows.map(r => `${r.step}\n  ${r.result}`)].join('\n');
}
