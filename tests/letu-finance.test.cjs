const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const finance = require('../letu-finance.js');
function snapshot() {
  const context = {window:{}};
  vm.runInNewContext(fs.readFileSync('data.js','utf8'), context);
  return JSON.parse(JSON.stringify(context.window.DASHBOARD));
}
const data = snapshot();
const originalOtherEntities = JSON.stringify(data.businessExpenses.records.filter(r=>r.entity==='ooo'));
const beforeSeptember = JSON.stringify(data.profit.months.filter(r=>r.month<'2026-10'));
finance.apply(data);
const oct = data.profit.months.find(r=>r.month==='2026-10').view;
const nov = data.profit.months.find(r=>r.month==='2026-11').view;
assert.equal(oct.turnoverKop,4196500);
assert.equal(oct.revenueKop,3775500);
assert.equal(oct.commissionKop,867900);
assert.equal(oct.commissionGapKop,0);
assert.equal(oct.courierKop,300000);
assert.equal(oct.deliveryCount,1);
assert.equal(oct.labelKop,17*600);
assert.equal(oct.purchaseKop,862210);
assert.equal(oct.freightKop,96800);
assert.equal(oct.taxKop,264285);
assert.equal(oct.resultKop,1297438);
assert.equal(oct.declarationKop,76667);
assert.equal(oct.expensesComplete,true);
for (const view of [oct,nov]) {
  assert.equal(view.boxKop+view.boxLabelKop+view.packerKop+view.filmKop,0);
  assert.equal(view.revenueKop-view.accountedKop,view.resultKop);
  assert.equal(view.commissionRows.reduce((s,r)=>s+r.withheldKop,0),view.commissionReportKop);
}
assert.equal(nov.turnoverKop,5096000);
assert.equal(nov.revenueKop,4853500);
assert.equal(nov.commissionKop,1040600);
assert.equal(nov.courierKop,null);
assert(nov.missingArticles.some(r=>r.article==='нутритив250'&&r.qty===3));
assert.equal(nov.expensesComplete,false);
assert.equal(nov.partial,true);
assert.equal(nov.declarationKop,38333);
assert.equal(data.letuFinance.deliveries['2026-10'].dates[0],'2026-10-01');
assert.equal(data.letuFinance.deliveries['2026-10'].requestDate,'2026-09-29');
const octoberReport = data.letuFinance.reports.find(r=>r.month==='2026-10');
assert.equal(octoberReport.totals.payoutKop+octoberReport.totals.advancesKop,2907600);
const octoberCash = data.receipts.months.find(r=>r.month==='2026-10');
assert.equal(octoberCash.receivedKop,1292500);
assert.equal(octoberCash.advanceKop,1292500);
assert.equal(octoberCash.payoutReceivedKop,0);
assert.equal(octoberCash.outstandingKop,1615100);
assert.equal(octoberCash.status,'open');
assert.equal(octoberCash.advancePaid,'2026-10-22');
assert.equal(octoberCash.payoutPaid,null);
assert.equal(octoberCash.advanceKop+octoberCash.outstandingKop, octoberReport.totals.realizationKop+octoberReport.totals.returnsKop-octoberReport.totals.commissionKop);
assert.equal(data.receipts.months.find(r=>r.month==='2026-09').outstandingKop,2330500);
assert.equal(octoberReport.totals.realizationKop+octoberReport.totals.returnsKop-octoberReport.totals.commissionKop,2907600);
assert(oct.commissionRows.filter(r=>['кремкудри','шампимбирь300','C151621'].includes(r.article)).every(r=>r.rate===0.46));
assert(!JSON.stringify(data.letuFinance.reports).includes('3568912507'),'No order identifiers in public aggregates');
assert.equal(JSON.stringify(data.profit.months.filter(r=>r.month<'2026-10')),beforeSeptember);
assert.equal(JSON.stringify(data.businessExpenses.records.filter(r=>r.entity==='ooo')),originalOtherEntities);
const once=JSON.stringify(data.profit.months);finance.apply(data);assert.equal(JSON.stringify(data.profit.months),once);
// Actual dates drive daily allocation, including half-month November coverage.
const example={amountKop:2300000,methodConfirmed:true,allocationMethod:'term',validFrom:'2023-01-01',validTo:'2027-12-31'};
const days=(Date.parse('2027-12-31')-Date.parse('2023-01-01'))/86400000+1;
assert.equal(finance.declarationShare(example,octoberReport),Math.round(2300000*31/days));
assert.equal(finance.declarationShare(example,data.letuFinance.reports[1]),Math.round(2300000*15/days));
assert.equal(finance.declarationShare({...example,validTo:null},octoberReport),null);
// A confirmed second trip affects the result exactly once.
const twoTrips=snapshot();twoTrips.letuFinance.deliveries['2026-10'].count=2;finance.apply(twoTrips);
assert.equal(twoTrips.profit.months.find(r=>r.month==='2026-10').view.resultKop,oct.resultKop-300000);
// Updating an existing product purchase cost affects only its sold net quantity.
const changed=snapshot();changed.unitEconomics.groups.find(g=>g.items.some(i=>i.article==='генезисгидра80')).items.find(i=>i.article==='генезисгидра80').rubPurchase=380;
finance.apply(changed);
assert.equal(changed.profit.months.find(r=>r.month==='2026-10').view.resultKop,oct.resultKop-20000);
console.log('L’Etual: report reconciliation, returns, actual commission, tax, one sticker, trip counts, declaration allocation, missing costs, privacy and unchanged prior periods passed');
