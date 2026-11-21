import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { fetchCoreBootstrap } from './bootstrap';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const tokenStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: { getItem: (key: string) => tokenStorage.get(key) ?? null, setItem: (key: string, value: string) => tokenStorage.set(key, value), removeItem: (key: string) => tokenStorage.delete(key) },
});
tokenStorage.set('bta_core_bearer_v1', 'a'.repeat(64));

afterEach(() => { globalThis.fetch = originalFetch; });

test('chargement bootstrap: pagination, bearer, IDs, stock agence et devises', async () => {
  const requests: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${'a'.repeat(64)}`);
    let data: Record<string, unknown>;
    if (url.pathname.endsWith('/categories')) data = { success:true, categories:[{id:'2',name:'Boissons',description:'Froid'}], pagination:{pages:1} };
    else if (url.pathname.endsWith('/products')) data = { success:true, products:[{id:'11',category_id:'2',sku:'EAU-1',name:'Eau',unit:'piece',purchase_price:'280000',sale_price:'560000',currency:'CDF',min_stock:'2',created_at:'2026-01-01',updated_at:'2026-01-02'}], pagination:{pages:1} };
    else if (url.pathname.endsWith('/customers')) data = { success:true, customers:[url.searchParams.get('page') === '2' ? {id:'22',name:'Deuxième page'} : {id:'21',name:'Amina',phone:'123',credit_limit:'50000',created_at:'2026-01-01'}], pagination:{pages:2} };
    else if (url.pathname.endsWith('/suppliers')) data = { success:true, suppliers:[{id:'31',name:'Grossiste',notes:'Farine',created_at:'2026-01-01'}] };
    else if (url.pathname.endsWith('/debts')) data = { success:true, debts:[{id:'90',customer_id:'21',sale_id:'50',original_amount:'56000',paid_amount:'28000',balance:'28000',currency:'CDF',status:'PARTIAL',due_at:'2026-02-01 00:00:00',created_at:'2026-01-01 00:00:00'}] };
    else if (url.pathname.endsWith('/sales')) data = { success:true, sales:[{id:'50',reference:'INV-50',currency:'CDF',exchange_rate:'2800'}], pagination:{pages:1} };
    else if (url.pathname.endsWith('/history/payments')) data = {success:true,tenant_id:4,branch_id:8,resource:'payments',items:[{id:'91',tenant_id:'4',branch_id:'8',entity_type:'DEBT',entity_id:'90',payment_type:'DEBT_PAYMENT',amount:'28000',currency:'CDF',method:'MOBILE_MONEY',reference:'REC-91',created_by:'6',created_at:'2026-01-15 10:00:00'}],has_more:false,next_cursor:null};
    else if (url.pathname.endsWith('/sync/pull') && url.searchParams.get('resource') === 'stock') data = {success:true,items:[{product_id:'11',quantity:'7'}],has_more:false,next_cursor:null};
    else if (url.pathname.endsWith('/sync/pull') && url.searchParams.get('resource') === 'stock_movements') data = {success:true,items:[{id:'81',product_id:'11',quantity:'3',movement_type:'PURCHASE_RECEIPT',created_at:'2026-01-02',notes:'Réception'}],has_more:false,next_cursor:null};
    else throw new Error(`Route inattendue ${url}`);
    return new Response(JSON.stringify(data), { status:200, headers:{'Content-Type':'application/json'} });
  };
  const result = await fetchCoreBootstrap(4, 8, 2800, ['stock.read','customers.read','suppliers.read','purchases.read','debts.read','sales.read']);
  assert.equal(result.categories[0].id, 'core-category-2');
  assert.equal(result.products[0].id, 'core-product-11');
  assert.equal(result.products[0].currentStock, 7);
  assert.equal(result.products[0].sellPriceUSD, 200);
  assert.equal(result.customers[0].debtBalanceUSD, 10);
  assert.equal(result.debts.length, 1);
  assert.equal(result.debts[0].id, 'core-debt-90');
  assert.equal(result.debts[0].partyId, 'core-customer-21');
  assert.equal(result.debts[0].referenceInvoice, 'INV-50');
  assert.equal(result.debts[0].remainingBalanceUSD, 10);
  assert.equal(result.debts[0].history[0].amountUSD, 10);
  assert.equal(result.debts[0].history[0].amountCDF, 28000);
  assert.equal(result.debts[0].history[0].paymentMethod, 'MOBILE_MONEY');
  assert.equal(result.customers.length, 2);
  assert.equal(result.customers[1].name, 'Deuxième page');
  assert.equal(result.suppliers[0].companyName, 'Grossiste');
  assert.equal(result.stockMovements[0].type, 'PURCHASE');
  assert.ok(requests.every(url => url.searchParams.get('branch_id') === '8'));
});

test('chargement bootstrap: ne demande pas les fournisseurs hors permissions', async () => {
  const paths: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); paths.push(url.pathname);
    let data: Record<string, unknown>;
    if (url.pathname.endsWith('/categories')) data = {success:true,categories:[],pagination:{pages:1}};
    else if (url.pathname.endsWith('/products')) data = {success:true,products:[],pagination:{pages:1}};
    else if (url.pathname.endsWith('/customers')) data = {success:true,customers:[]};
    else if (url.pathname.endsWith('/debts')) data = {success:true,debts:[]};
    else if (url.pathname.endsWith('/sales')) data = {success:true,sales:[],pagination:{pages:1}};
    else if (url.pathname.endsWith('/history/payments')) data = {success:true,tenant_id:4,branch_id:8,resource:'payments',items:[],has_more:false,next_cursor:null};
    else if (url.pathname.endsWith('/sync/pull')) data = {success:true,items:[],has_more:false,next_cursor:null};
    else throw new Error(`Route inattendue ${url}`);
    return new Response(JSON.stringify(data), {status:200});
  };
  const result = await fetchCoreBootstrap(4,8,2800,['stock.read','customers.read','debts.read']);
  assert.deepEqual(result.suppliers, []);
  assert.equal(paths.some(path => path.endsWith('/suppliers')), false);
});

after(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
  else delete (globalThis as {sessionStorage?: Storage}).sessionStorage;
});
