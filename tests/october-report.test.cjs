const fs = require("fs");
const vm = require("vm");
const assert = require("assert/strict");
const path = require("path");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8"), context);
const data = context.window.DASHBOARD;
const month = data.months.find((row) => row.month === "2026-10");
const profit = data.profit.months.find((row) => row.month === "2026-10");
const receipt = data.receipts.months.find((row) => row.month === "2026-10");
const lines = month.reportLines;

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + row[key], 0);
}

assert.equal(month.report.number, "ОК001344644");
assert.equal(month.financeState, "month");
assert.equal(month.financeEnd, "2026-10-31");
assert.equal(lines.length, 19);
assert.equal(sum(lines.filter((row) => row.qty > 0), "sumKop"), 4196500);
assert.equal(sum(lines.filter((row) => row.qty < 0), "sumKop"), -421000);
assert.equal(sum(lines, "commissionKop"), 1005400);
assert.equal(sum(lines, "discountKop"), 137500);
assert.equal(month.realizationKop, 4196500);
assert.equal(month.returnsKop, -421000);
assert.equal(month.commissionAfterKop, 867900);
assert.equal(month.advancesKop, 1292500);
assert.equal(month.marketingKop, 0);
assert.equal(month.payoutKop, 1615100);
assert.equal(
  month.realizationKop + month.returnsKop - month.commissionAfterKop - month.advancesKop - month.marketingKop,
  month.payoutKop
);
assert.equal(sum(month.lineBrands, "commissionKop"), 1005400);

lines.forEach((row) => {
  assert.equal(Math.round(row.listKop * row.ratePercent / 100) * Math.sign(row.qty), row.commissionKop);
  assert.equal(row.priceKop * row.qty, row.sumKop);
});

const withheld = profit.view.commissionRows.reduce((acc, row) => acc + row.withheldKop, 0);
assert.equal(withheld, month.commissionAfterKop);
assert.equal(profit.view.commissionGapKop, 0);
assert.equal(profit.revenueKop, 3775500);
assert.equal(profit.view.resultKop, 1769805);
assert.equal(profit.view.coveredResultKop, 1333019);
assert.equal(profit.partial, false);
assert.equal(profit.view.unconfirmed.length, 0);
assert.equal(profit.view.missingArticles.length, 1);
assert.equal(profit.view.missingArticles[0].article, "E3547501/E3547500");

assert.equal(receipt.advanceKop, 1292500);
assert.equal(receipt.advancePaid, "2026-10-22");
assert.equal(receipt.payoutReceivedKop, 0);
assert.equal(receipt.outstandingKop, 1615100);
assert.equal(receipt.status, "open");
assert.equal(data.profit.coverage.financeFullThrough, "2026-10-31");

const cream = data.unitEconomics.groups
  .flatMap((group) => group.items)
  .find((item) => item.article === "кремкудри");
assert.equal(cream.commissionRate, 0.46);

console.log("Passed: October executor report ОК001344644 reconciles to the dashboard.");
