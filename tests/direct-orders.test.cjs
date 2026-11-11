const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');

const context = {
  window: {},
  Intl, Date, BigInt, Number, Map, Set, structuredClone,
  fetch: () => new Promise(() => {}),
  crypto: require('crypto').webcrypto,
  console,
  localStorage: {getItem: () => null, setItem() {}}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'purchases.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'direct-orders.js'), 'utf8'), context);
const purchases = context.window.PurchaseBook.core;
let ledger = {schemaVersion: 1, orders: [], movements: []};
['purchases-data.json', 'purchases-orders.json', 'purchase-receipt-2026-06-29.json', 'purchase-receipt-2026-05-18.json'].forEach(name => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));
  data.orders.forEach(order => {
    const index = ledger.orders.findIndex(item => item.id === order.id);
    const merged = purchases.mergeShared(index < 0 ? null : ledger.orders[index], order);
    if (!merged.changed) return;
    if (index < 0) ledger.orders.push(merged.record);
    else ledger.orders[index] = merged.record;
  });
});
purchases.database = () => ledger;
const api = context.window.DirectOrders.core;

const seedFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'direct-orders.json'), 'utf8'));
assert.equal(seedFile.orders.length, 1);
const seed = seedFile.orders[0];
api.validate({schemaVersion: 1, orders: [seed]});
assert.equal(seed.client, 'Валерий Романовский');
assert.equal(seed.totalKop, 3160000);
assert.equal(seed.channel, 'прямой заказ');
assert.equal(seed.compositionStatus, 'known');
assert.equal(seed.lines.length, 18);
const lineSum = seed.lines.reduce((sum, line) => sum + line.qty * line.priceMinor, 0);
const lineQty = seed.lines.reduce((sum, line) => sum + line.qty, 0);
assert.equal(lineSum, 3160000);
assert.equal(lineQty, 43);
assert.equal(lineSum, seed.totalKop);
assert.equal(seed.lines.find(line => line.sku === 'C151616').qty, 4);
assert.equal(seed.lines.find(line => line.sku === 'C151616').priceMinor, 73000);
assert.equal(seed.lines.find(line => line.sku === 'C151613').priceMinor, 64000);
assert.match(seed.compositionNote, /31 600 ₽/);
assert.match(seed.compositionNote, /43/);
assert.equal(seed.paymentStatus, 'partial');
assert.equal(seed.paidKop, 2312000);
assert.equal(seed.date, '2026-11-06');
assert.equal(seed.number, '');
assert.equal(seed.fulfillmentStatus, 'done');
assert.equal(seed.delivery, 'Оплачена клиентом, 0 ₽ в расходе заказа');
assert.match(seed.comment, /личную карту/);

const totals = api.totals([seed]);
assert.equal(totals.count, 1);
assert.equal(totals.sumKop, 3160000);
assert.equal(totals.paidKop, 2312000);
assert.equal(totals.debtKop, 848000);
const seedProfit = api.orderProfit(seed);
assert.equal(seedProfit.state, 'known');
assert.equal(seedProfit.freightGap, false);
assert.equal(seedProfit.taxKop, 0);
assert.equal(seedProfit.outboundKop, 0);
assert.equal(seedProfit.boxKop, 0);
assert.equal(seedProfit.packingKop, 5500);
assert.equal(seedProfit.saleKop, 3160000);
assert.equal(seedProfit.profitKop, 1764668);
assert.equal(seedProfit.lines.length, 18);
assert.ok(seedProfit.lines.every(line => line.state === 'known' && line.profitKop > 0 && line.moscowFreight === 'included'));

const again = api.appendOrders({schemaVersion: 1, orders: [], updatedAt: null}, [seed]);
assert.equal(again.changed, 1);
const duplicate = api.appendOrders(again.db, [seed]);
assert.equal(duplicate.changed, 0);
assert.equal(duplicate.db.orders.length, 1);
const otherId = {...seed, id: 'another-copy'};
const blocked = api.appendOrders(again.db, [otherId]);
assert.equal(blocked.skipped, 1);
assert.equal(blocked.db.orders.length, 1);

const unpaid = {...seed, id: 'unpaid', client: 'Анна', paymentStatus: 'unpaid', paidKop: null};
api.validateOrder(unpaid);
assert.equal(JSON.stringify(api.paymentFacts(unpaid)), JSON.stringify({known: true, paidKop: 0, debtKop: 3160000}));
const partial = {...seed, id: 'partial', client: 'Борис', paymentStatus: 'partial', paidKop: 500000};
assert.equal(JSON.stringify(api.paymentFacts(partial)), JSON.stringify({known: true, paidKop: 500000, debtKop: 2660000}));
const paid = {...seed, id: 'paid', client: 'Вера', paymentStatus: 'paid', paidKop: 3160000};
assert.equal(JSON.stringify(api.paymentFacts(paid)), JSON.stringify({known: true, paidKop: 3160000, debtKop: 0}));
const mixed = api.totals([seed, unpaid]);
assert.equal(mixed.sumKop, 6320000);
assert.equal(mixed.paidKop, 2312000);
assert.equal(mixed.paidCount, 2);
assert.equal(mixed.debtKop, 4008000);
assert.equal(mixed.debtCount, 2);

const undated = {...unpaid, id: 'undated', client: 'Галина', date: ''};
const period = api.applyFilters([seed, {...unpaid, date: '2026-11-01'}, undated], {from: '2026-11-01', to: '2026-11-07', client: '', payment: 'all', fulfillment: 'all'});
assert.equal(period.undated, 1);
assert.equal(period.orders.length, 2);
assert.equal(JSON.stringify(period.orders.map(order => order.client)), JSON.stringify(['Валерий Романовский', 'Анна']));
const byClient = api.applyFilters([seed, unpaid], {from: '', to: '', client: 'Валерий Романовский', payment: 'partial', fulfillment: 'done'});
assert.equal(byClient.orders.length, 1);

context.window.UnitCost = {
  find(sku) {
    if (sku === 'ambiguous') return {ambiguous: true};
    if (sku === 'missing') return null;
    if (sku === 'incomplete') return {article: sku};
    return {article: sku};
  },
  accountedUnitCost(row) {
    if (row.article === 'incomplete') return null;
    return 1000;
  }
};
const priced = {
  ...seed, id: 'priced', compositionStatus: 'known', compositionNote: '',
  paymentStatus: 'unknown', paidKop: null,
  lines: [{sku: 'shampoo', name: 'Шампунь', brand: 'KERASTASE', qty: 2, priceMinor: 150000}]
};
priced.totalKop = 300000;
api.validateOrder(priced);
const profit = api.orderProfit(priced);
assert.equal(profit.state, 'known');
assert.equal(profit.costKop, 200000);
assert.equal(profit.profitKop, 100000);
const gap = api.orderProfit({...priced, lines: [{...priced.lines[0], sku: 'incomplete'}]});
assert.equal(gap.state, 'needs-clarification');
assert.equal(gap.profitKop, undefined);
assert.equal(api.orderProfit({...priced, lines: [{...priced.lines[0], sku: 'missing'}]}).state, 'needs-clarification');
assert.equal(api.orderProfit({...priced, lines: [{...priced.lines[0], sku: 'ambiguous'}]}).state, 'needs-clarification');

const draft = api.normalOrder({
  id: 'draft', number: '', date: '2026-11-06', client: 'Валерий Романовский', channel: 'прямой заказ',
  clarify: true, totalText: '31 600', paymentStatus: 'unknown', paidText: '',
  fulfillmentStatus: 'unknown', delivery: '', comment: ''
});
assert.equal(draft.totalKop, 3160000);
assert.equal(draft.paidKop, null);
assert.equal(draft.compositionNote, 'Состав заказа требует уточнения');
assert.throws(() => api.normalOrder({...draft, id: 'second', clarify: false, lines: [] , totalText: '100', paymentStatus: 'unknown', paidText: '', fulfillmentStatus: 'unknown'}), /товары/i);
const manual = api.appendOrders(again.db, [{...draft, id: 'manual-duplicate'}]);
assert.equal(manual.skipped, 1);
assert.equal(manual.db.orders.length, 1);

console.log('Passed: seed order stays unspecified except client, channel and 23 000; debt ignores unknown payment; duplicate is rejected; profit uses full unit cost and stays uncalculated when cost is incomplete.');
