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

test('Targeted: sale currency conversion and rejected retry preserve stock and local sale', async () => {
  repo.coreContext={tenantId:7,branchId:4};repo.state.syncInfo.status='OFFLINE';
  await mapServerId(7,'products','currency-product',931);
  const sale={id:'currency-sale',invoiceNumber:'FC-1',items:[{productId:'currency-product',quantity:2,unitPriceUSD:3}],exchangeRate:2800,discountUSD:1,amountPaidUSD:5,paymentMethod:'CASH'};
  const usd=await repo.toCorePayload('SALE_CREATE',sale);
  const fc=await repo.toCorePayload('SALE_CREATE',{...sale,currency:'CDF'});
  assert.equal(usd.currency,'USD');assert.equal(usd.items[0].unit_price,3);
  assert.equal(fc.currency,'CDF');assert.equal(fc.items[0].unit_price,8400);
  assert.equal(fc.discount,2800);assert.equal(fc.paid,14000);
  repo.state.sales=[sale];repo.state.products=[{id:'currency-product',currentStock:8}];
  repo.state.offlineQueue=[{id:'rejected-sale',type:'SALE_CREATE',payload:sale,status:'FAILED',corePayload:usd}];
  repo.retryFailedCoreOperation('rejected-sale');
  assert.equal(repo.state.offlineQueue.length,1);assert.notEqual(repo.state.offlineQueue[0].id,'rejected-sale');
  assert.equal(repo.state.offlineQueue[0].corePayload,undefined);
  assert.equal(repo.state.sales.length,1);assert.equal(repo.state.products[0].currentStock,8);
  if(repo.persistTimer)clearTimeout(repo.persistTimer);
});

test('Targeted: category and customer require resource acknowledgements; optional photo stays empty', async () => {
  repo.coreContext={tenantId:7,branchId:4};
  for(const [type,key,id] of [['CATEGORY_CREATE','category',941],['CUSTOMER_CREATE','customer',942]] as const){
    const op={id:`ack-${key}`,type,payload:{id:`local-${key}`}};
    await assert.rejects(repo.applyCoreAck(op,{success:true}),{code:'bta_sync_manual_review'});
    await repo.applyCoreAck(op,{success:true,[key]:{id}});
    assert.equal(await getServerId(7,key==='category'?'categories':'customers',`local-${key}`),id);
    assert.ok(repo.getCoreOperationHistory().some((x:any)=>x.id===op.id&&x.status==='DONE'));
  }
  const product={id:'no-photo',unit:'pcs',photoUrl:''};
  assert.equal((await repo.toCorePayload('PRODUCT_CREATE',product)).image_url,'');
  // Local-image transmission is exercised by the media-specific tests.
  if(repo.persistTimer)clearTimeout(repo.persistTimer);
});

test('Finalisation: local category/customer creation through durable queue and server history; photo persists locally', async () => {
  repo.coreContext={tenantId:7,branchId:4};repo.corePermissions=new Set(['stock.manage','customers.manage']);
  repo.state.coreScope={tenantId:7,branchId:4};repo.state.offlineQueue=[];repo.state.coreSyncHistory=[];
  repo.state.syncInfo.status='OFFLINE';repo.isBootstrapping=false;
  repo.sessionUserId='final-manager';repo.state.currentUser={id:'final-manager',role:'GESTIONNAIRE',name:'Manager'};
  repo.state.categories=[];repo.state.customers=[];repo.state.products=[];
  const category=repo.addCategory('Final category','');
  const customer=repo.saveCustomer({name:'Final customer',phone:'',email:'',address:'',city:'',creditLimitUSD:0,debtBalanceUSD:0});
  assert.deepEqual(repo.state.offlineQueue.map((x:any)=>x.type),['CATEGORY_CREATE','CUSTOMER_CREATE']);
  await repo.flushDurableAndWait();
  const disk=await localforage.getItem<any>('bta_business_transform_africa_db_v1');
  assert.equal(disk.categories[0].id,category.id);assert.equal(disk.customers[0].id,customer.id);
  assert.equal(disk.offlineQueue.length,2);
  const originalFetch=globalThis.fetch;const sent:any[]=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=> 'a'.repeat(64)}});
  globalThis.fetch=async (_input,options)=>{
    const body=JSON.parse(String(options?.body));sent.push(body);
    const key=body.type==='category_create'?'category':'customer';
    return new Response(JSON.stringify({success:true,operation_id:body.operation_id,[key]:{id:key==='category'?951:952}}),{status:201});
  };
  try{
    repo.state.syncInfo.status='ONLINE';assert.equal(await repo.coreSync(),true);
    assert.equal(sent.length,2);assert.equal(repo.state.offlineQueue.length,0);
    assert.equal(repo.state.coreSyncHistory.filter((x:any)=>x.status==='DONE').length,2);
    await repo.flushDurableAndWait();
    assert.equal((await localforage.getItem<any>('bta_business_transform_africa_db_v1')).coreSyncHistory.length,2);
    repo.state.syncInfo.status='OFFLINE';
    const photo='data:image/png;base64,aGVsbG8=';
    const product=repo.saveProduct({name:'Local photo',sku:'PHOTO-FINAL',barcode:'',categoryId:category.id,brand:'',description:'',photoUrl:photo,buyPriceUSD:1,sellPriceUSD:2,currentStock:0,minStock:0,unit:'pcs',variants:[]});
    await repo.flushDurableAndWait();
    const saved=await localforage.getItem<any>('bta_business_transform_africa_db_v1');
    assert.equal(saved.products.find((x:any)=>x.id===product.id).photoUrl,photo);
    assert.equal(saved.offlineQueue[0].payload.photoUrl,photo);
    repo.state.syncInfo.status='ONLINE';assert.equal(await repo.coreSync(),false);
    assert.equal(sent.length,3);assert.equal(repo.state.offlineQueue[0].status,'PROCESSING');
    assert.equal(repo.state.coreSyncHistory.filter((x:any)=>x.type==='PRODUCT_CREATE'&&x.status==='DONE').length,0);
  }finally{globalThis.fetch=originalFetch;if(repo.persistTimer)clearTimeout(repo.persistTimer);}
});

test('Photos: lost upload acknowledgement preserves image; retry replaces it only after matching server hash', async () => {
  repo.coreContext={tenantId:7,branchId:4};repo.state.syncInfo.status='OFFLINE';
  const photo='data:image/png;base64,aGVsbG8=';
  const raw={id:'image-retry',name:'Photo',unit:'pcs',photoUrl:photo};
  repo.state.products=[{...raw}];
  const original=globalThis.fetch;let attempts=0;
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=> 'a'.repeat(64)}});
  globalThis.fetch=async (_input,options)=>{
    attempts++;const body=JSON.parse(String(options?.body));assert.equal(body.data_url,photo);assert.equal(body.branch_id,4);
    if(attempts===1)throw new Error('lost upload ACK');
    return new Response(JSON.stringify({success:true,sha256:'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',image_url:'https://example.test/photo.png'}));
  };
  try{
    await assert.rejects(repo.toCorePayload('PRODUCT_CREATE',raw));
    assert.equal(raw.photoUrl,photo);assert.equal(repo.state.products[0].photoUrl,photo);
    const payload=await repo.toCorePayload('PRODUCT_CREATE',raw);
    assert.equal(payload.image_url,'https://example.test/photo.png');
    assert.equal(repo.state.products[0].photoUrl,payload.image_url);
    await repo.flushDurableAndWait();
    assert.equal((await localforage.getItem<any>('bta_business_transform_africa_db_v1')).products[0].photoUrl,payload.image_url);
  }finally{globalThis.fetch=original;if(repo.persistTimer)clearTimeout(repo.persistTimer);}
});

test('Repayments: decimal amounts, strict balance cap and CDF debt amount', () => {
  repo.state.syncInfo.status='OFFLINE';repo.isBootstrapping=false;repo.sessionUserId='payer';
  repo.state.currentUser={id:'payer',name:'Payer',role:'ADMIN'};repo.state.settings.exchangeRate=2800;
  repo.state.customers=[];repo.state.sales=[];
  for(const amount of [25,25.5,25.50,24.60]){
    repo.state.offlineQueue=[];repo.state.debts=[{id:'decimal-debt',type:'CUSTOMER',partyId:'none',remainingBalanceUSD:30,paidAmountUSD:0,history:[]}];
    assert.equal(repo.recordDebtRepayment('decimal-debt',amount,'BANK_TRANSFER').success,true);
    assert.equal(repo.state.debts[0].remainingBalanceUSD,Math.round((30-amount)*100)/100);
  }
  repo.state.offlineQueue=[];repo.state.debts=[{id:'cap',type:'CUSTOMER',remainingBalanceUSD:24.60,paidAmountUSD:0,history:[],referenceInvoice:'CDF-DEBT'}];
  for(const amount of [25,24.61,24.601,0.001,NaN,Infinity])assert.equal(repo.recordDebtRepayment('cap',amount,'CASH').success,false);
  assert.equal(repo.state.offlineQueue.length,0);
  repo.state.sales=[{invoiceNumber:'CDF-DEBT',currency:'CDF',exchangeRate:2800}];
  assert.equal(repo.recordDebtRepayment('cap',24.60,'CASH').success,true);
  assert.equal(repo.state.offlineQueue[0].payload.amount,68880);
  if(repo.persistTimer)clearTimeout(repo.persistTimer);
});

test('Multi-user: local-only creation refused under Core and actor change puts pending operations in review', () => {
  repo.coreContext={tenantId:7,branchId:4};repo.sessionUserId='core:9';repo.state.currentUser={id:'core:9',role:'ADMIN'};
  const count=repo.state.users.length;
  assert.throws(()=>repo.addUser({name:'Other phone'},'4826'),/profil local/);
  assert.equal(repo.state.users.length,count);
  repo.state.coreScope={tenantId:7,branchId:4};repo.state.coreActorId=9;
  repo.state.offlineQueue=[{id:'actor-pending',type:'CATEGORY_CREATE',payload:{id:'x'},status:'PENDING'}];
  repo.activateCoreUser({id:10,name:'Other',email:'other@example.invalid',role:'MANAGER',tenantId:7,branchId:4});
  assert.equal(repo.state.offlineQueue[0].status,'REVIEW');
  assert.equal(repo.state.currentUser.id,'core:10');
  if(repo.persistTimer)clearTimeout(repo.persistTimer);
});
