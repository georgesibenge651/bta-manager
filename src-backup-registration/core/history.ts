import localforage from 'localforage';
import {CoreHistoryResource,coreHistoryPage} from './api';
export type HistoryContext={tenantId:number;branchId:number;userId:number};
export type CoreHistory={receivedAt:string;records:Partial<Record<CoreHistoryResource,Array<Record<string,unknown>>>>};
const key=(c:HistoryContext)=>`core-history:${c.tenantId}:${c.branchId}:${c.userId}`;
export function historyResources(permissions:string[]):CoreHistoryResource[]{
  return (['sales','debts','payments','refunds'] as CoreHistoryResource[]).filter(r=>
    r==='debts'?permissions.includes('debts.read'):r==='payments'?permissions.includes('sales.read')&&permissions.includes('debts.read'):permissions.includes('sales.read'));
}
export async function cachedHistory(c:HistoryContext,permissions:string[]):Promise<CoreHistory|null>{
  const stored=await localforage.getItem<CoreHistory>(key(c));
  if(!stored)return null;
  return {...stored,records:Object.fromEntries(historyResources(permissions).filter(r=>stored.records[r]).map(r=>[r,stored.records[r]]))};
}
/** Separate confirmed-server cache: pending sales, debts and outbox are never mutated. */
export async function refreshHistory(c:HistoryContext,permissions:string[]):Promise<CoreHistory>{
  const records:CoreHistory['records']={};
  for(const resource of historyResources(permissions)){
    const rows=new Map<string,Record<string,unknown>>();let cursor=0;
    for(let page=0;;page++){
      if(page>=10000)throw new Error('Pagination historique excessive.');
      const r=await coreHistoryPage(c.tenantId,c.branchId,resource,cursor);
      if(r.success!==true||r.tenant_id!==c.tenantId||r.branch_id!==c.branchId||r.resource!==resource||!Array.isArray(r.items))throw new Error('Contexte historique Core invalide.');
      for(const row of r.items){
        if(Number(row.tenant_id)!==c.tenantId||('branch_id' in row&&Number(row.branch_id)!==c.branchId))throw new Error('Historique hors établissement refusé.');
        rows.set(String(row.id),row);
      }
      if(!r.has_more)break;
      if(!Number.isSafeInteger(r.next_cursor)||Number(r.next_cursor)<=cursor)throw new Error('Curseur historique invalide.');
      cursor=Number(r.next_cursor);
    }
    records[resource]=[...rows.values()];
  }
  const result={receivedAt:new Date().toISOString(),records};await localforage.setItem(key(c),result);return result;
}
