import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cachedHistory,refreshHistory,historyResources} from './history';
import {coreCreateInvitation,coreRegisterInvited,coreAcceptInvitation,coreRevokeInvitation} from './api';
const context={tenantId:7,branchId:4,userId:9};
Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=> 'a'.repeat(64)}});

test('History: two devices receive same paginated rows; scope caches and pending writes remain isolated',async()=>{
 const original=globalThis.fetch;const requests:string[]=[];
 const {appRepository}=await import('../db/storage');const repo=appRepository as any;
 repo.state.offlineQueue=[{id:'pending-local',type:'SALE_CREATE',payload:{id:'sale-local'},status:'PENDING'}];
 repo.state.sales=[{id:'sale-local',syncStatus:'PENDING'}];
 const before=JSON.stringify({sales:repo.state.sales,queue:repo.state.offlineQueue});
 globalThis.fetch=async(input)=>{
  const url=new URL(String(input));requests.push(url.pathname);const resource=url.pathname.split('/').at(-1);
  const cursor=Number(url.searchParams.get('cursor'));
  return new Response(JSON.stringify({success:true,tenant_id:7,branch_id:4,resource,items:[{id:cursor?2:1,tenant_id:7,branch_id:4,created_by:42,total:25,currency:'USD'}],has_more:resource==='sales'&&!cursor,next_cursor:resource==='sales'&&!cursor?1:null}));
 };
 try{
  const a=await refreshHistory(context,['sales.read','debts.read']);
  const b=await refreshHistory({...context,userId:10},['sales.read','debts.read']);
  assert.deepEqual(a.records,b.records);assert.equal(a.records.sales?.length,2);
  assert.equal(a.records.sales?.[0].created_by,42);
  assert.equal(JSON.stringify({sales:repo.state.sales,queue:repo.state.offlineQueue}),before);
  assert.equal(await cachedHistory({...context,tenantId:8},['sales.read']),null);
  assert.equal(await cachedHistory({...context,branchId:5},['sales.read']),null);
  assert.equal(await cachedHistory({...context,userId:11},['sales.read']),null);
  assert.deepEqual(Object.keys((await cachedHistory(context,['debts.read']))!.records),['debts']);
  assert.deepEqual(historyResources(['stock.read']),[]);
  await assert.rejects(refreshHistory({...context,tenantId:8},['sales.read']),/Contexte/);
  assert.equal(await cachedHistory({...context,tenantId:8},['sales.read']),null);
  assert.ok(requests.some(p=>p.endsWith('/refunds')));
 }finally{globalThis.fetch=original;}
});

test('Invitations: API contracts use Core routes and registration never sends a role or bearer',async()=>{
 const original=globalThis.fetch;const seen:any[]=[];
 globalThis.fetch=async(input,options)=>{seen.push({url:String(input),...options,body:options?.body?JSON.parse(String(options.body)):undefined});return new Response(JSON.stringify({success:true}));};
 try{
  await coreCreateInvitation(7,'CASHIER',[4]);
  await coreRegisterInvited('7.'+'b'.repeat(64),'New user','new@example.test','strong-password-4826');
  await coreAcceptInvitation('7.'+'b'.repeat(64));await coreRevokeInvitation(123);
  assert.deepEqual(seen[0].body,{role:'CASHIER',branches:[4]});
  assert.ok(seen[1].url.endsWith('/auth/register-invited'));
  assert.equal(seen[1].body.role,undefined);assert.equal(seen[1].headers.Authorization,undefined);
  assert.ok(seen[2].url.endsWith('/invitations/accept'));
  assert.ok(seen[3].url.endsWith('/invitations/123/revoke'));
 }finally{globalThis.fetch=original;}
});
