import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import localforage from 'localforage';

const { appRepository } = await import('./storage');
const { mapServerId, getServerId } = await import('../core/persistence');
const repo = appRepository as any;
const values = new Map<string,string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,v: string) => { values.set(key,v); }, removeItem: (key: string) => values.delete(key) };
Object.defineProperty(globalThis, 'window', { configurable:true, value:{ localStorage:storage } });
Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:storage });
const snapshot = (branchId=4) => ({tenantId:7,branchId,downloadedAt:new Date().toISOString(),categories:[{id:'core-category-2',name:'Category'}],products:[{id:'core-product-3',categoryId:'core-category-2',name:'Product',currentStock:10}],customers:[],suppliers:[],stockMovements:[]}) as any;

test('Core: stable IDs, preserved histories and isolated branch queues survive reload', async () => {
  repo.state.coreScope={tenantId:7,branchId:4};
  repo.state.offlineQueue=[];
  repo.state.sales=[{id:'sale-local',items:[{productId:'product-local'}]}];
  repo.state.debts=[{id:'debt-local'}];
  repo.state.reservations=[{id:'reservation-local'}];
  await mapServerId(7,'products','product-local',3);
  await mapServerId(7,'categories','category-local',2);
  await repo.applyCoreSnapshot(snapshot(),'server');
  assert.equal(repo.state.products[0].id,'product-local');
  assert.equal(repo.state.products[0].categoryId,'category-local');
  assert.equal(await getServerId(7,'products','product-local'),3);
  assert.equal(repo.state.sales[0].id,'sale-local');
  assert.equal(repo.state.debts[0].id,'debt-local');
  assert.equal(repo.state.reservations[0].id,'reservation-local');
  repo.state.offlineQueue=[{id:'op-a',type:'CATEGORY_CREATE',payload:{id:'pending-category'},status:'FAILED'}];
  repo.state.categories.push({id:'pending-category',name:'Pending'});
  await repo.applyCoreSnapshot(snapshot(5),'server');
  assert.equal(repo.state.offlineQueue.length,0);
  assert.equal(repo.state.sales.length,0);
  await repo.applyCoreSnapshot(snapshot(),'cache');
  assert.equal(repo.state.offlineQueue[0].id,'op-a');
  assert.equal(repo.state.categories.filter((row:any)=>row.id==='pending-category').length,1);
  assert.equal(repo.state.sales[0].id,'sale-local');
  assert.equal(repo.state.syncInfo.status,'OFFLINE');
});

test('Core: queue copies values, missing relationship blocks, personal PIN profile survives activation', async () => {
  repo.coreContext={tenantId:7,branchId:4};
  repo.state.syncInfo.status='OFFLINE';
  const raw={id:'local-customer',name:'Before'};
  repo.enqueue('CUSTOMER_CREATE',raw);raw.name='After';
  assert.equal(repo.state.offlineQueue.at(-1).payload.name,'Before');
  await assert.rejects(repo.toCorePayload('PRODUCT_CREATE',{id:'new',categoryId:'not-yet-mapped',unit:'pcs'}),{code:'bta_id_mapping_missing'});
  const user={id:9,name:'Test',email:'test@example.invalid',role:'OWNER',tenantId:7,branchId:4};
  repo.state.users.push({id:'core:9',pinHash:'test-hash',pinSalt:'test-salt'});
  repo.activateCoreUser(user);
  repo.logout();repo.activateCoreUser(user);
  assert.equal(repo.state.currentUser.pinHash,'test-hash');
  assert.equal(repo.state.currentUser.pinSalt,'test-salt');
  assert.equal(repo.state.users.filter((row:any)=>row.id==='core:9').length,1);
  assert.equal(repo.changeUserPin('core:9', '4826'), true);
  const personalHash = repo.state.currentUser.pinHash;
  await repo.flushDurableAndWait();
  const disk = await localforage.getItem<any>('bta_business_transform_africa_db_v1');
  assert.equal(disk.users.find((item:any)=>item.id==='core:9').pinHash, personalHash);
  repo.state = repo.loadFromStorage();
  repo.logout(); repo.activateCoreUser(user);
  assert.equal(repo.state.currentUser.pinHash, personalHash);
  assert.equal(repo.verifyUserPin('core:9','4826'),true);
  assert.equal(repo.currentUserHasDefaultPin(),false);
  if(repo.persistTimer)clearTimeout(repo.persistTimer);
});

test('Core: ambiguous network failure retries the same UUID and frozen payload after reconciliation', async () => {
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=> 'a'.repeat(64)}});
  repo.state.offlineQueue=[];repo.state.syncInfo.status='ONLINE';
  repo.coreContext={tenantId:7,branchId:4};repo.state.coreScope={tenantId:7,branchId:4};
  repo.enqueue('CUSTOMER_CREATE',{id:'customer-network',name:'Original'});
  const queued=repo.state.offlineQueue[0];
  const sent:any[]=[];
  const originalFetch=globalThis.fetch;
  let fail=true;
  globalThis.fetch=async (_input,options)=>{
    if(!options?.body)return new Response(JSON.stringify({code:'bta_sync_operation_not_found',message:'Absent'}),{status:404});
    const body=JSON.parse(String(options.body));sent.push(body);
    if(fail){fail=false;throw new Error('simulated connection loss');}
    return new Response(JSON.stringify({success:true,operation_id:body.operation_id,customer:{id:83}}),{status:201});
  };
  try {
    assert.equal(await repo.coreSync(),false);
    assert.equal(queued.status,'PROCESSING');
    queued.payload.name='Edited after transmission';
    assert.equal(await repo.coreSync(),true);
    assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);
    assert.equal(repo.state.offlineQueue.length,0);
    assert.equal(await getServerId(7,'customers','customer-network'),83);
  } finally {globalThis.fetch=originalFetch;if(repo.persistTimer)clearTimeout(repo.persistTimer);}
});


test('Core: product deletion queues archival and rejects remaining stock', async () => {
  repo.corePermissions = new Set(['stock.manage']);
  repo.state.syncInfo.status='OFFLINE';repo.state.offlineQueue=[];
  repo.state.products=[{id:'product-local',name:'Archive',currentStock:1}];
  assert.throws(()=>repo.deleteProduct('product-local'),/stock/i);
  repo.state.products[0].currentStock=0;
  repo.state.reservations=[];
  repo.deleteProduct('product-local');
  assert.equal(repo.state.products.length,0);
  assert.equal(repo.state.offlineQueue[0].type,'PRODUCT_ARCHIVE');
  const payload=await repo.toCorePayload('PRODUCT_ARCHIVE',repo.state.offlineQueue[0].payload);
  assert.deepEqual(payload,{branch_id:4,product_id:3,status:'ARCHIVED'});
  await repo.applyCoreSnapshot(snapshot(),'cache');
  assert.equal(repo.state.products.length,0);
  if(repo.persistTimer)clearTimeout(repo.persistTimer);
});


test('Core: effective branch permissions reject a local write before mutation', () => {
  repo.corePermissions = new Set();
  const before=JSON.stringify(repo.state.customers);
  assert.throws(()=>repo.saveCustomer({name:'Denied customer'}),/Permission Core refusée/);
  assert.equal(JSON.stringify(repo.state.customers),before);
});
