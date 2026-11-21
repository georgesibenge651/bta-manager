import {coreHistoryPage} from './api';
import {getLocalId,mapServerId} from './persistence';
import type {Sale,SaleItem} from '../types';
export async function fetchSharedSales(tenantId:number,branchId:number):Promise<Sale[]>{
 const output:Sale[]=[];let cursor=0;
 for(let page=0;page<10000;page++){
  const response=await coreHistoryPage(tenantId,branchId,'sales',cursor);
  if(!response.success||response.tenant_id!==tenantId||response.branch_id!==branchId)throw new Error('Contexte des ventes invalide.');
  for(const row of response.items){
   if(Number(row.tenant_id)!==tenantId||Number(row.branch_id)!==branchId||!Array.isArray(row.items))throw new Error('Vente partagée incomplète ou hors établissement.');
   const serverId=Number(row.id);if(!Number.isSafeInteger(serverId)||serverId<=0)throw new Error('ID vente invalide.');
   const id=await getLocalId(tenantId,'sales',serverId)??`core-sale-${serverId}`;
   await mapServerId(tenantId,'sales',id,serverId);
   const rate=Number(row.exchange_rate)||1;const factor=row.currency==='CDF'?rate:1;
   const usd=(v:unknown)=>Number(v??0)/factor;
   const items=await Promise.all((row.items as Record<string,unknown>[]).map(async item=>({
    productId:await getLocalId(tenantId,'products',Number(item.product_id))??`core-product-${item.product_id}`,
    productName:String(item.product_name??''),sku:String(item.sku??''),buyPriceUSD:Number(item.unit_cost??0)/(item.product_currency==='CDF'?rate:1),quantity:Number(item.quantity),unitPriceUSD:usd(item.unit_price),totalUSD:usd(item.line_total),unit:(item.product_unit==='piece'?'pcs':String(item.product_unit??'pcs')) as SaleItem['unit'],
   })));
   output.push({id,currency:row.currency==='CDF'?'CDF':'USD',invoiceNumber:String(row.reference),items,
    customerId:row.customer_id?(await getLocalId(tenantId,'customers',Number(row.customer_id))??`core-customer-${row.customer_id}`):undefined,
    customerName:String(row.customer_name??'Client comptant'),subtotalUSD:usd(row.subtotal),discountUSD:usd(row.discount),totalUSD:usd(row.total),totalCDF:usd(row.total)*rate,
    exchangeRate:rate,paymentMethod:Number(row.balance)>0?(Number(row.paid)>0?'PARTIAL':'CREDIT'):row.payment_method==='BANK'?'BANK_TRANSFER':row.payment_method==='MOBILE_MONEY'?'MOBILE_MONEY':'CASH',amountPaidUSD:usd(row.paid),amountPaidCDF:usd(row.paid)*rate,debtAmountUSD:usd(row.balance),
    status:row.status==='CANCELLED'?'CANCELLED':row.status==='REFUNDED'?'REFUNDED':'COMPLETED',cashierId:`core:${row.created_by}`,cashierName:String(row.author_name??`Utilisateur ${row.created_by}`),
    date:String(row.created_at).replace(' ','T')+(/Z$|[+-]\d\d:\d\d$/.test(String(row.created_at))?'':'Z'),syncStatus:'SYNCED',notes:String(row.notes??''),
   });
  }
  if(!response.has_more)return output;
  if(!response.next_cursor||response.next_cursor<=cursor)throw new Error('Curseur ventes invalide.');cursor=response.next_cursor;
 }
 throw new Error('Historique des ventes trop volumineux.');
}
export function mergeSharedSales(remote:Sale[],local:Sale[],pending:Array<{type:string;payload:unknown}>):Sale[]{
 const protectedIds=new Set(pending.map(op=>(op.payload as {id?:string})?.id));
 const merged=new Map(local.map(s=>[s.id,s]));
 for(const sale of remote)if(!protectedIds.has(sale.id)&&(!merged.has(sale.id)||merged.get(sale.id)!.syncStatus==='SYNCED'))merged.set(sale.id,sale);
 return [...merged.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
/** One request cycle at a time, foreground only, with capped error backoff. */
export function startSharedPolling(task:(active:()=>boolean)=>Promise<boolean>,host=window,doc=document){
 let stopped=false,running=false,delay=60000;let timer:ReturnType<typeof setTimeout>;
 const schedule=()=>{clearTimeout(timer);if(!stopped)timer=setTimeout(()=>void run(),delay);};
 const run=async()=>{if(stopped||running)return;if(doc.hidden||!navigator.onLine){schedule();return;}running=true;
  try{delay=await task(()=>!stopped)?60000:Math.min(delay*2,300000);}catch{delay=Math.min(delay*2,300000);}finally{running=false;schedule();}};
 const wake=()=>{if(!doc.hidden){clearTimeout(timer);void run();}};
 host.addEventListener('bta-core-sync-finished',wake);host.addEventListener('online',wake);host.addEventListener('focus',wake);doc.addEventListener('visibilitychange',wake);schedule();
 return()=>{stopped=true;clearTimeout(timer);host.removeEventListener('bta-core-sync-finished',wake);host.removeEventListener('online',wake);host.removeEventListener('focus',wake);doc.removeEventListener('visibilitychange',wake);};
}
