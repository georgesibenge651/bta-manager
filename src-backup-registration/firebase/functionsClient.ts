import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { FIREBASE_PROJECT_ID, FUNCTIONS_REGION } from '../utils/config';

/**
 * Appel d'une Cloud Function « callable » en HTTPS avec le jeton Firebase de l'utilisateur.
 * (Le plugin Capacitor n'embarque pas de client Functions ; le protocole callable est simple :
 *  POST {data} + Authorization: Bearer <idToken> → { result } ou { error }.)
 */
export class CallableError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Connexion Firebase requise.',
  PERMISSION_DENIED: 'Action non autorisée.',
  NOT_FOUND: 'Élément introuvable.',
  RESOURCE_EXHAUSTED: 'Limite atteinte.',
  FAILED_PRECONDITION: 'Opération impossible dans l’état actuel.',
  INVALID_ARGUMENT: 'Données invalides.',
};

export async function callFunction<T>(name: string, data: unknown, timeoutMs = 20000): Promise<T> {
  const { token } = await FirebaseAuthentication.getIdToken({ forceRefresh: false });
  if (!token) throw new CallableError('UNAUTHENTICATED', MESSAGES.UNAUTHENTICATED);

  const url = `https://${FUNCTIONS_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/${name}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const status = String(body?.error?.status || 'UNKNOWN');
      throw new CallableError(status, body?.error?.message || MESSAGES[status] || 'Erreur serveur.');
    }
    return body.result as T;
  } catch (e) {
    if (e instanceof CallableError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new CallableError('TIMEOUT', 'Le serveur ne répond pas.');
    throw new CallableError('NETWORK', 'Réseau indisponible : cette action exige une connexion.');
  } finally {
    clearTimeout(timer);
  }
}
