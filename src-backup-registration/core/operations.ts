import localforage from 'localforage';
import { generateUUID } from '../utils/currency';
import { coreOperationStatus, corePushOperation, CoreApiError } from './api';
import { CoreQueuedOperation, confirmCoreOperation, listCoreOperations, updateCoreOperation } from './persistence';

export interface CoreContext { tenantId: number; branchId: number }
let running = false;

/** Queue first, transmit second. The persistent record is only DONE after Core confirms the UUID. */
export async function queueCoreOperation(context: CoreContext, type: CoreQueuedOperation['type'], payload: Record<string, unknown>): Promise<CoreQueuedOperation> {
  const { enqueueCoreOperation } = await import('./persistence');
  return enqueueCoreOperation({ tenantId: context.tenantId, branchId: context.branchId, type, payload, operationId: generateUUID() });
}

async function reconcile(operation: CoreQueuedOperation): Promise<'DONE'|'PROCESSING'|'FAILED'|'REVIEW'|'NOT_FOUND'> {
  try {
    const status = await coreOperationStatus(operation.tenantId, operation.operationId);
    if (status.status === 'DONE') {
      await confirmCoreOperation(operation, status.result ?? { success: true, operation_id: status.operation_id, duplicate: true });
      return 'DONE';
    }
    if (status.status === 'FAILED') {
      operation.state = 'FAILED'; operation.error = status.error ?? { code: 'bta_sync_failed', message: 'Opération refusée par Core.' };
      await updateCoreOperation(operation); return 'FAILED';
    }
    if (status.status === 'REVIEW') {
      operation.state = 'REVIEW'; operation.error = status.error ?? { code: 'bta_sync_manual_review', message: 'Vérification manuelle requise.' };
      await updateCoreOperation(operation); return 'REVIEW';
    }
    operation.state = 'PROCESSING'; await updateCoreOperation(operation); return 'PROCESSING';
  } catch (error) {
    if (error instanceof CoreApiError && error.status === 404 && error.code === 'bta_sync_operation_not_found') return 'NOT_FOUND';
    throw error;
  }
}

export async function flushCoreOperations(context: CoreContext): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const operation of await listCoreOperations(context.tenantId, context.branchId)) {
      if (operation.state === 'DONE' || operation.state === 'FAILED' || operation.state === 'REVIEW') continue;
      if (operation.state === 'PROCESSING') {
        const outcome = await reconcile(operation);
        if (outcome === 'PROCESSING') break;
        if (outcome !== 'NOT_FOUND') continue;
      }
      operation.state = 'PROCESSING'; operation.attempts += 1;
      await updateCoreOperation(operation);
      try {
        const result = await corePushOperation(operation.tenantId, operation.operationId, operation.type, operation.payload);
        if (result.operation_id !== operation.operationId || result.success !== true) {
          operation.state = 'REVIEW'; operation.error = { code: 'bta_sync_invalid_ack', message: 'Accusé Core invalide; opération conservée pour vérification.' };
          await updateCoreOperation(operation); break;
        }
        await confirmCoreOperation(operation, result);
      } catch (error) {
        if (error instanceof CoreApiError && error.status === 409) {
          const code = error.code;
          if (code === 'bta_sync_in_progress') {
            const outcome = await reconcile(operation);
            if (outcome === 'PROCESSING') break;
            if (outcome === 'DONE' || outcome === 'FAILED' || outcome === 'REVIEW') continue;
          }
          operation.state = code === 'bta_sync_manual_review' ? 'REVIEW' : 'FAILED';
          operation.error = { code, message: error.message };
          await updateCoreOperation(operation);
          continue;
        }
        if (error instanceof CoreApiError && error.status > 0 && error.status < 500) {
          operation.state = 'FAILED'; operation.error = { code: error.code, message: error.message };
          await updateCoreOperation(operation); continue;
        }
        // A network loss can happen after the server committed. Keep PROCESSING; next run
        // checks the stable UUID before retrying the exact same immutable payload.
        await updateCoreOperation(operation);
        break;
      }
    }
  } finally { running = false; }
}
