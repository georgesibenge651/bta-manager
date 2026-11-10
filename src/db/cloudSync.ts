import { callFunction, CallableError } from '../firebase/functionsClient';
import { Effects, PULL_ORDER } from './syncEngine';

export interface CloudCtx { tenantId: string; branchId: string }
export interface OpResult { opId: string; status: 'APPLIED' | 'DUPLICATE' | 'REJECTED'; reason?: string; notes?: string[] }
export interface PulledDoc { id: string; data: Record<string, any> }
export interface PullCursor {
  since: number;
  collectionIndex: number;
  afterVersion?: number;
  afterId?: string;
  serverTime: number;
  recovered: number;
  /** Collections ciblées lors d'un rattrapage différé, si présent. */
  collections?: string[];
  /** Collections ignorées faute de permission et à retenter au prochain cycle. */
  deferredCollections?: string[];
}

const TRANSIENT = new Set(['NETWORK', 'TIMEOUT', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED']);
export const isTransient = (e: unknown) => e instanceof CallableError && TRANSIENT.has(e.code);

/** Envoie jusqu'à 10 opérations ; le serveur répond opération par opération. */
export async function pushOps(
  ctx: CloudCtx, ops: { opId: string; createdAt: number; effects: Effects }[]
): Promise<OpResult[]> {
  const r = await callFunction<{ results: OpResult[] }>('syncOperations', { ...ctx, ops }, 60000);
  return r.results;
}

/** Streams every page and checkpoints after each page so process death can resume safely. */
export async function pullAll(
  ctx: CloudCtx,
  initial: PullCursor,
  onPage: (collection: string, docs: PulledDoc[], cursor: PullCursor) => Promise<void>,
): Promise<PullCursor> {
  let cursor: PullCursor = { ...initial };
  const seen = new Set<string>();
  const order = cursor.collections ?? PULL_ORDER;
  const deferred = new Set(cursor.deferredCollections ?? []);
  for (let ci = cursor.collectionIndex; ci < order.length;) {
    const collection = order[ci];
    const request: Record<string, unknown> = { ...ctx, collection, since: cursor.since };
    if (cursor.afterVersion !== undefined && cursor.afterId !== undefined) {
      request.afterVersion = cursor.afterVersion;
      request.afterId = cursor.afterId;
    }
    let page: { docs: PulledDoc[]; hasMore: boolean; serverTime: number };
    try {
      page = await callFunction('pullChanges', request, 60000);
    } catch (e) {
      if (e instanceof CallableError && e.code === 'PERMISSION_DENIED') {
        // Do not lose this collection: storage persists it and retries it on a later sync.
        deferred.add(collection);
        cursor = { ...cursor, deferredCollections: [...deferred], collectionIndex: ci + 1,
          afterVersion: undefined, afterId: undefined };
        await onPage(collection, [], cursor);
        ci++;
        continue;
      }
      throw e;
    }
    deferred.delete(collection);
    if (!Array.isArray(page.docs) || typeof page.hasMore !== 'boolean' || !Number.isFinite(page.serverTime)) {
      throw new Error(`Réponse de pagination invalide pour ${collection}.`);
    }
    if (page.hasMore && page.docs.length === 0) throw new Error(`Curseur bloqué sur ${collection} : page vide annoncée avec hasMore.`);
    let afterVersion = cursor.afterVersion;
    let afterId = cursor.afterId;
    for (const doc of page.docs) {
      const key = `${collection}:${doc.id}`;
      if (seen.has(key)) throw new Error(`Document répété pendant la pagination de ${collection}.`);
      seen.add(key);
      const v = Number(doc.data?.serverVersion);
      if (!Number.isFinite(v) || typeof doc.id !== 'string' || !doc.id) throw new Error(`Curseur invalide pour ${collection}.`);
      if (afterVersion !== undefined && afterId !== undefined &&
        (v < afterVersion || (v === afterVersion && doc.id <= afterId))) {
        throw new Error(`Le curseur n'avance pas pour ${collection}.`);
      }
      afterVersion = v;
      afterId = doc.id;
    }
    if (page.hasMore) {
      cursor = { ...cursor, deferredCollections: [...deferred], afterVersion, afterId,
        serverTime: cursor.serverTime || page.serverTime, recovered: cursor.recovered + page.docs.length };
      await onPage(collection, page.docs, cursor);
    } else {
      cursor = { ...cursor, deferredCollections: [...deferred], collectionIndex: ci + 1,
        afterVersion: undefined, afterId: undefined, serverTime: cursor.serverTime || page.serverTime,
        recovered: cursor.recovered + page.docs.length };
      await onPage(collection, page.docs, cursor);
      ci++;
    }
  }
  return cursor;
}
