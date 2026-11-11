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
    else if (url.pathname.endsWith('/customers')) data = { success:true, customers:[{id:'21',name:'Amina',phone:'123',credit_limit:'50000',created_at:'2026-01-01'}] };
    else if (url.pathname.endsWith('/suppliers')) data = { success:true, suppliers:[{id:'31',name:'Grossiste',notes:'Farine',created_at:'2026-01-01'}] };
    else if (url.pathname.endsWith('/debts')) data = { success:true, debts:[{customer_id:'21',balance:'28000',currency:'CDF'}] };
    else if (url.pathname.endsWith('/sync/pull') && url.searchParams.get('resource') === 'stock') data = {success:true,items:[{product_id:'11',quantity:'7'}],has_more:false,next_cursor:null};
    else if (url.pathname.endsWith('/sync/pull') && url.searchParams.get('resource') === 'stock_movements') data = {success:true,items:[{id:'81',product_id:'11',quantity:'3',movement_type:'PURCHASE_RECEIPT',created_at:'2026-01-02',notes:'Réception'}],has_more:false,next_cursor:null};
    else throw new Error(`Route inattendue ${url}`);
    return new Response(JSON.stringify(data), { status:200, headers:{'Content-Type':'application/json'} });
  };
  const result = await fetchCoreBootstrap(4, 8, 2800, ['stock.read','customers.read','suppliers.read','purchases.read','debts.read']);
  assert.equal(result.categories[0].id, 'core-category-2');
  assert.equal(result.products[0].id, 'core-product-11');
  assert.equal(result.products[0].currentStock, 7);
  assert.equal(result.products[0].sellPriceUSD, 200);
  assert.equal(result.customers[0].debtBalanceUSD, 10);
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
