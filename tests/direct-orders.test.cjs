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
assert.equal(seed.totalKop, 2300000);
assert.equal(seed.channel, 'прямой заказ');
assert.equal(seed.compositionStatus, 'mismatch');
assert.equal(seed.lines.length, 9);
const lineSum = seed.lines.reduce((sum, line) => sum + line.qty * line.priceMinor, 0);
assert.equal(lineSum, 2312000);
assert.equal(seed.lines.find(line => line.sku === 'C102247').unit, 'компл.');
assert.match(seed.compositionNote, /23 120 ₽/);
assert.match(seed.compositionNote, /23 000 ₽/);
assert.match(seed.compositionNote, /120 ₽/);
assert.equal(seed.paymentStatus, 'unknown');
assert.equal(seed.paidKop, null);
assert.equal(seed.date, '');
assert.equal(seed.number, '');
assert.equal(seed.fulfillmentStatus, 'unknown');
assert.equal(seed.delivery, 'Оплачена клиентом, 0 ₽ в расходе заказа');
assert.match(seed.comment, /личную карту/);

const totals = api.totals([seed]);
assert.equal(totals.count, 1);
assert.equal(totals.sumKop, 2300000);
assert.equal(totals.paidKop, null);
assert.equal(totals.debtKop, null);
const seedProfit = api.orderProfit(seed);
assert.equal(seedProfit.state, 'known');
assert.equal(seedProfit.freightGap, true);
assert.equal(seedProfit.taxKop, 0);
assert.equal(seedProfit.outboundKop, 0);
assert.equal(seedProfit.boxKop, 0);
assert.equal(seedProfit.packingKop, 5500);
assert.equal(seedProfit.saleKop, 2312000);
assert.equal(seedProfit.profitKop, 980913);
assert.equal(seedProfit.lines.length, 9);
assert.ok(seedProfit.lines.every(line => line.state === 'known'));
assert.equal(seedProfit.lines.find((_, i) => seed.lines[i].sku === 'SKUK502').moscowFreight, 'included');
assert.equal(seedProfit.lines.find((_, i) => seed.lines[i].sku === 'C151604').moscowFreight, 'not-in-batch');
const freeLine = seedProfit.lines[seed.lines.findIndex(line => line.sku === 'SKUK502')];
const fourLine = seedProfit.lines[seed.lines.findIndex(line => line.sku === 'SKUK5022')];
assert.ok(fourLine.profitKop > freeLine.profitKop);
assert.ok(freeLine.unitFreightKop > 60000);

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
assert.equal(JSON.stringify(api.paymentFacts(unpaid)), JSON.stringify({known: true, paidKop: 0, debtKop: 2300000}));
const partial = {...seed, id: 'partial', client: 'Борис', paymentStatus: 'partial', paidKop: 500000};
assert.equal(JSON.stringify(api.paymentFacts(partial)), JSON.stringify({known: true, paidKop: 500000, debtKop: 1800000}));
const paid = {...seed, id: 'paid', client: 'Вера', paymentStatus: 'paid', paidKop: 2300000};
assert.equal(JSON.stringify(api.paymentFacts(paid)), JSON.stringify({known: true, paidKop: 2300000, debtKop: 0}));
const mixed = api.totals([seed, unpaid]);
assert.equal(mixed.sumKop, 4600000);
assert.equal(mixed.paidKop, 0);
assert.equal(mixed.paidCount, 1);
assert.equal(mixed.debtKop, 2300000);
assert.equal(mixed.debtCount, 1);

const period = api.applyFilters([seed, {...unpaid, date: '2026-11-01'}], {from: '2026-11-01', to: '2026-11-07', client: '', payment: 'all', fulfillment: 'all'});
assert.equal(period.undated, 1);
assert.equal(period.orders.length, 1);
assert.equal(period.orders[0].client, 'Анна');
const byClient = api.applyFilters([seed, unpaid], {from: '', to: '', client: 'Валерий Романовский', payment: 'unknown', fulfillment: 'unknown'});
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
  id: 'draft', number: '', date: '', client: 'Валерий Романовский', channel: 'прямой заказ',
  clarify: true, totalText: '23 000', paymentStatus: 'unknown', paidText: '',
  fulfillmentStatus: 'unknown', delivery: '', comment: ''
});
assert.equal(draft.totalKop, 2300000);
assert.equal(draft.paidKop, null);
assert.equal(draft.compositionNote, 'Состав заказа требует уточнения');
assert.throws(() => api.normalOrder({...draft, id: 'second', clarify: false, lines: [] , totalText: '100', paymentStatus: 'unknown', paidText: '', fulfillmentStatus: 'unknown'}), /товары/i);
const manual = api.appendOrders(again.db, [{...draft, id: 'manual-duplicate'}]);
assert.equal(manual.skipped, 1);
assert.equal(manual.db.orders.length, 1);

console.log('Passed: seed order stays unspecified except client, channel and 23 000; debt ignores unknown payment; duplicate is rejected; profit uses full unit cost and stays uncalculated when cost is incomplete.');
