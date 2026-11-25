import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {displayCompanyName} from './branding';
import {fetchSharedSales,startSharedPolling} from './shared';
import {mapServerId} from './persistence';
import {appRepository} from '../db/storage';
const repo=appRepository as any;
Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=> 'a'.repeat(64)}});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:storage}});
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});

test('Shared: phone B sends sale; phone A refreshes stock and invoice; pending local projection survives',async()=>{
 let stock=10;const committed=new Map<string,any>();const sales:any[]=[];let lose=false;
 const original=globalThis.fetch;
 const product={id:'core-product-3',name:'Product',categoryId:'',currentStock:9};
 const sale={id:'phone-b-sale',invoiceNumber:'B-001',date:'2026-11-14T12:00:00Z',items:[{productId:product.id,quantity:1,unitPriceUSD:2}],exchangeRate:2800,discountUSD:0,amountPaidUSD:2,paymentMethod:'CASH',syncStatus:'PENDING'};
 repo.coreContext={tenantId:7,branchId:4};repo.state.coreScope={tenantId:7,branchId:4};repo.state.coreActorId=2;repo.sessionUserId='core:2';repo.isBootstrapping=false;
 repo.state.products=[product];repo.state.sales=[sale];repo.state.offlineQueue=[{id:'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',type:'SALE_CREATE',payload:{...sale},status:'PENDING'}];repo.state.syncInfo.status='ONLINE';
 await mapServerId(7,'products',product.id,3);
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));const json=(x:any)=>new Response(JSON.stringify(x));
  if(options?.body){
   if(lose)throw new Error('Phone A offline during write');
   const body=JSON.parse(String(options.body));
   if(!committed.has(body.operation_id)){
    stock--;const row={id:91,tenant_id:7,branch_id:4,reference:body.payload.reference,currency:'USD',exchange_rate:2800,subtotal:2,discount:0,total:2,paid:2,balance:0,status:'COMPLETED',created_at:'2026-11-14 12:00:00',created_by:2,author_name:'Employé B',payment_method:'CASH',items:[{product_id:3,product_name:'Product',quantity:1,unit_price:2,line_total:2}]};sales.push(row);committed.set(body.operation_id,{success:true,operation_id:body.operation_id,sale:{id:91}});
   }return json(committed.get(body.operation_id));
  }
  if(url.pathname.endsWith('/history/sales'))return json({success:true,tenant_id:7,branch_id:4,resource:'sales',items:sales,has_more:false,next_cursor:null});
  if(url.pathname.endsWith('/categories'))return json({categories:[]});
  if(url.pathname.endsWith('/products'))return json({products:[{id:3,name:'Product',sale_price:2,currency:'USD'}]});
  if(url.pathname.endsWith('/sync/pull'))return json({items:url.searchParams.get('resource')==='stock'?[{product_id:3,quantity:stock}]:[],has_more:false,next_cursor:null});
  throw new Error('Unexpected route '+url.pathname);
 };
 try{
  assert.equal(await repo.coreSync(),true);assert.equal(stock,9);
  repo.state.products=[{...product,currentStock:10}];repo.state.sales=[];repo.state.offlineQueue=[];repo.state.coreActorId=1;repo.sessionUserId='core:1';repo.corePermissions=new Set(['stock.read','sales.read']);
  assert.equal(await repo.refreshSharedCoreData({tenantId:7,branchId:4,userId:1},()=>true),true);
  assert.equal(repo.state.products[0].currentStock,9);assert.equal(repo.state.sales[0].invoiceNumber,'B-001');assert.equal(repo.state.sales[0].cashierName,'Employé B');assert.equal(repo.state.sales[0].items[0].productName,'Product');assert.equal(repo.state.sales[0].syncStatus,'SYNCED');
  lose=true;const pending={...sale,id:'pending-a',invoiceNumber:'A-PENDING',syncStatus:'PENDING'};repo.state.products[0].currentStock=8;repo.state.sales.push(pending);repo.state.offlineQueue=[{id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',type:'SALE_CREATE',payload:pending,status:'PENDING'}];
  await repo.refreshSharedCoreData({tenantId:7,branchId:4,userId:1},()=>true);
  assert.equal(repo.state.products[0].currentStock,8);assert.equal(repo.state.offlineQueue.length,1);assert.equal(repo.state.sales.find((s:any)=>s.id==='pending-a').syncStatus,'PENDING');assert.equal(stock,9);assert.equal(committed.size,1);
  await assert.rejects(fetchSharedSales(8,4),/Contexte/);
  assert.equal(await repo.refreshSharedCoreData({tenantId:8,branchId:4,userId:1},()=>true),false);
 }finally{globalThis.fetch=original;if(repo.persistTimer)clearTimeout(repo.persistTimer);}
});

test('Polling: foreground timer, no overlap, resume event and stop; visible company aliases only',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const host=new EventTarget();const doc=Object.assign(new EventTarget(),{hidden:false});let calls=0;let release!:()=>void;
 const stop=startSharedPolling(async()=>{calls++;await new Promise<void>(resolve=>{release=resolve;});return true;},host as any,doc as any);
 t.mock.timers.tick(60000);assert.equal(calls,1);host.dispatchEvent(new Event('focus'));host.dispatchEvent(new Event('bta-core-sync-finished'));assert.equal(calls,1);
 release();await Promise.resolve();await Promise.resolve();doc.hidden=true;t.mock.timers.tick(60000);assert.equal(calls,1);
 doc.hidden=false;host.dispatchEvent(new Event('online'));assert.equal(calls,2);stop();release();await Promise.resolve();t.mock.timers.tick(300000);assert.equal(calls,2);
 assert.equal(displayCompanyName('Fondation Kenda Corp'),'CHIEF ALPHONS COMPANY LTD');assert.equal(displayCompanyName('Autre entreprise'),'Autre entreprise');
});
