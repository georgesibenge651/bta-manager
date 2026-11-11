/**
 * Sonde réseau TEMPORAIRE (diagnostic uniquement). Aucun secret : faux identifiants, faux jeton.
 * Elle sépare : réseau/TLS/DNS, CORS (requête simple), préflight JSON, préflight Authorization.
 */
type Row = { step: string; result: string };

async function attempt(step: string, url: string, init: RequestInit): Promise<Row> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text().catch(() => '');
    const body = init.mode === 'no-cors' ? '(opaque)' : text.slice(0, 80).replace(/\s+/g, ' ');
    return { step, result: `OK HTTP ${r.status} ${Date.now() - t0}ms ${body}` };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { step, result: `ÉCHEC ${err.name ?? 'Error'}: ${err.message ?? e} ${Date.now() - t0}ms` };
  } finally { clearTimeout(timer); }
}

export async function runNetProbe(base: string): Promise<string> {
  const fakeToken = '0'.repeat(64);
  const fake = JSON.stringify({ email: 'probe@example.invalid', password: 'probe-invalid' });
  const rows: Row[] = [];
  rows.push(await attempt('A GET /health (no-cors)  → joignable ?', `${base}/health`, { mode: 'no-cors' }));
  rows.push(await attempt('B GET /health (cors)     → CORS simple', `${base}/health`, { headers: { Accept: 'application/json' } }));
  rows.push(await attempt('C POST login text/plain  → sans préflight', `${base}/auth/login`,
    { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: fake }));
  rows.push(await attempt('D POST login JSON        → préflight Content-Type', `${base}/auth/login`,
    { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: fake }));
  rows.push(await attempt('E GET auth/me + Bearer   → préflight Authorization', `${base}/auth/me`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${fakeToken}` } }));
  const head = [
    `base=${base}`, `origin=${location.origin}`, `online=${navigator.onLine}`,
    `date=${new Date().toISOString()}`, `ua=${navigator.userAgent}`,
  ];
  return [...head, ...rows.map(r => `${r.step}\n   ${r.result}`)].join('\n');
}
