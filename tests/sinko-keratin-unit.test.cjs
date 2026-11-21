const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync('data.js', 'utf8'), context);
const data = context.window.DASHBOARD;
const groups = data.unitEconomics.groups.filter(g => (g.items || []).some(i => ['SKUK501', 'SKUK503', 'SKUK504'].includes(i.article)));
assert.equal(groups.length, 3);

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function economics(group) {
  const item = group.items[0];
  const purchase = group.rubPurchase;
  const freight = group.allocatedFreightRub;
  const sticker = group.productLabelRub;
  assert.equal(group.boxExcluded, true);
  assert.equal(group.boxLabelExcluded, true);
  assert.equal(group.filmExcluded, true);
  assert.equal(item.filmExcluded, true);
  assert.equal(group.packerRub, 0);
  const cost = roundMoney(purchase + freight + sticker);
  const sale = item.salePriceRub;
  const commission = roundMoney(sale * item.commissionRate);
  const tax = roundMoney(sale * data.unitEconomics.taxRate);
  const profit = roundMoney(sale - cost - commission - tax);
  return { cost, sale, commission, tax, profit, margin: profit / sale };
}

const byArticle = Object.fromEntries(groups.map(g => [g.items[0].article, economics(g)]));

assert.equal(byArticle.SKUK501.cost, 342.63);
assert.equal(byArticle.SKUK501.sale, 2900);
assert.equal(byArticle.SKUK501.commission, 1334);
assert.equal(byArticle.SKUK501.tax, 203);
assert.equal(byArticle.SKUK501.profit, 1020.37);
assert.equal(groups.find(g => g.items[0].article === 'SKUK501').items[0].listPriceRub, 3900);
assert.equal(groups.find(g => g.items[0].article === 'SKUK501').items[0].alcorArticle, 'MPL714829');

for (const article of ['SKUK503', 'SKUK504']) {
  assert.equal(byArticle[article].cost, 436.11);
  assert.equal(byArticle[article].sale, 2900);
  assert.equal(byArticle[article].commission, 1334);
  assert.equal(byArticle[article].tax, 203);
  assert.equal(byArticle[article].profit, 926.89);
  assert.equal(groups.find(g => g.items[0].article === article).items[0].listPriceRub, 3900);
  assert.equal(groups.find(g => g.items[0].article === article).items[0].alcorArticle, null);
}

assert.ok(byArticle.SKUK501.margin > 0.30);
assert.ok(byArticle.SKUK503.margin > 0.30);
assert.ok(byArticle.SKUK504.margin > 0.30);
