const fs=require('fs'), vm=require('vm'), assert=require('assert/strict');
const source=fs.readFileSync('bank-klm.json','utf8'), data=JSON.parse(source);
const ctx={window:{},location:{hostname:'localhost'},fetch:()=>new Promise(()=>{}),console,Event,Set};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('bank.js','utf8'),ctx);
const api=ctx.window.BankLedger;assert(api.core.validate(data));api.core.setData(data);
assert.equal(data.inflows.length,12);assert.equal(data.outflows.length,20);
assert.equal(data.inflows.filter(r=>r.kind==='founder_funding').reduce((s,r)=>s+r.amountKop,0),19100000);
assert.equal(data.openingKop+data.incomingKop-data.outgoingKop,4896861);
const all={from:'2026-01-01',to:'2026-11-15'};
assert.equal(api.evidence('ozon-ooo',all).amountKop,0);
assert.equal(api.evidence('ozon-ooo',all).complete,true);
assert.equal(api.evidence('ozon-ooo',all).from,'2026-01-01');
assert.equal(api.evidence('wb-ooo',all).amountKop,429626);
assert.equal(api.evidence('wb-ooo',{from:'2026-08-01',to:'2026-10-31'}).amountKop,0);
assert.equal(api.evidence('ozon-ooo',{from:'2025-01-01',to:'2025-12-31'}),null);
assert(api.render(all).includes('Взнос учредителя, не выручка'));
assert(api.expensePanel('declarations').includes('Все три декларации по журналу'));
assert.equal(data.outflows.filter(r=>r.category==='declarations').reduce((s,r)=>s+r.amountKop,0),6900000);
assert(!/407028|408028|263688|322500|5003170916/.test(source));
const broken=structuredClone(data);broken.outflows[0].amountKop++;assert(!api.core.validate(broken));
const duplicate=structuredClone(data);duplicate.outflows[0].id=duplicate.outflows[1].id;assert(!api.core.validate(duplicate));
vm.runInContext(fs.readFileSync('data.js','utf8'),ctx);
const records=ctx.window.DASHBOARD.businessExpenses.records;
const bank=records.filter(r=>r.bankSource==='bank-klm-20260101-20261116');
assert.equal(bank.length,20);assert.equal(new Set(bank.map(r=>r.id)).size,20);
assert.equal(bank.reduce((s,r)=>s+r.amountKop,0),data.outgoingKop);
assert(bank.every(r=>r.entity==='ooo'&&r.payerEntity==='ooo'&&r.beneficiaryEntity==='ooo'));
assert.equal(records.filter(r=>/^decl-ooo-2026-/.test(r.id)).length,2);
assert.equal(bank.filter(r=>r.category==='declarations').length,3);
assert.equal(bank.find(r=>r.id.endsWith('-enp')).amountKop,813000);
assert.equal(bank.filter(r=>r.category==='fines').reduce((s,r)=>s+r.amountKop,0),200000);
assert.equal(bank.filter(r=>r.category==='bank-fees').reduce((s,r)=>s+r.amountKop,0),45000);
assert.equal(data.markingPaymentsKop,50000);


const collection=bank.filter(r=>r.id.includes('-tax-collection-'));
assert.equal(collection.length,2);assert.equal(collection.reduce((s,r)=>s+r.amountKop,0),102235);
assert(collection.every(r=>r.category==='unclassified'&&r.title.includes('21634')&&r.title.includes('21.09.2026')&&r.needs.includes('paymentNature')));
for(const r of collection){const statement=data.outflows.find(b=>b.id===r.id);assert.equal(statement.amountKop,r.amountKop);assert.equal(statement.category,r.category);assert.equal(statement.title,r.title);}
assert(!api.render(all).includes('Предполагаемый штраф ФНС'));

assert.equal(data.fromDate,'2026-01-01');assert.equal(data.toDate,'2026-11-16');
assert.equal(data.openingKop,0);assert.equal(data.incomingKop,19529626);assert.equal(data.outgoingKop,14632765);
assert.equal(data.outflows.filter(r=>r.date<'2026-08-01').reduce((s,r)=>s+r.amountKop,0),7968000);
assert.equal(data.outflows.filter(r=>r.date<'2026-08-01').length,9);
assert.equal(bank.filter(r=>!r.id.startsWith('decl-ooo-')&&r.date<'2026-08-01').reduce((s,r)=>s+r.amountKop,0),3368000);
assert.equal(bank.find(r=>r.id==='decl-ooo-2026-1').date,'2026-07-07');
assert.equal(bank.find(r=>r.id==='decl-ooo-2026-2').date,'2026-07-13');
assert(data.priorDeclarations.every(r=>r.includedInOutflows&&r.bankConfirmed));
for(const row of data.outflows){const expense=bank.find(r=>r.id===row.expenseId);assert(expense);assert.equal(expense.amountKop,row.amountKop);assert.equal(expense.date,row.date);assert.equal(expense.category,row.category);}
assert.equal(new Set(data.outflows.map(r=>r.expenseId)).size,20);
assert.equal(bank.find(r=>r.id.endsWith('-fau-nia')).category,'unclassified');
assert.equal(bank.find(r=>r.id.endsWith('-wb-license')).channelScope,'wb-ooo');
assert(api.render(all).includes('69'+String.fromCharCode(160)+'000,00'));
assert(!api.render(all).includes('115'+String.fromCharCode(160)+'000,00'));
assert(api.expensePanel('marking').includes('предоплата'));
console.log('Bank year: exact totals, 20 outflows, 12 inflows, all dates, declaration deduplication and uncertain payments passed');
