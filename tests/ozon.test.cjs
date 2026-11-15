const fs=require('fs'), vm=require('vm'), assert=require('assert/strict');
const context={window:{},location:{hostname:'localhost'},fetch:()=>new Promise(()=>{}),console,Event};
vm.createContext(context);
vm.runInContext(fs.readFileSync('ozon.js','utf8'),context);
const api=context.window.OzonDashboard;
const months=Array.from({length:12},(_,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,state:'future'}));
months[0]={month:'2026-01',state:'ready',fromDate:'2026-01-01',toDate:'2026-01-31',partial:false,
  sales:{state:'ready',salesQty:3,returnsQty:1,salesKop:30003,returnsKop:10001,reportAccruedKop:17000,products:[]},
  balance:{state:'ready',openingKop:10000,closingKop:8000,accruedKop:3000,reportedPaymentsKop:5000,paidKop:5000,paymentReconciled:true}};
months[1]={month:'2026-02',state:'partial',fromDate:'2026-02-01',toDate:'2026-02-15',partial:true,
  sales:{state:'unavailable'},balance:{state:'unavailable'}};
const data={schemaVersion:1,year:2026,owner:'ooo',generatedAt:'2026-02-15T12:00:00+03:00',fromDate:'2026-01-01',toDate:'2026-02-15',months,
  stocks:{state:'ready',asOf:'2026-02-15T12:00:00+03:00',warehouseDetailState:'ready',fboState:'ready',rows:[
    {article:'X',name:'<script>unsafe</script>',scheme:'FBS/rFBS',warehouse:'A',present:10,reserved:3,available:7},
    {article:'X',name:'Test',scheme:'FBO',warehouse:'B',present:null,reserved:null,available:2}]},cashflow:{state:'unavailable'}};
assert(api.core.validate(data)); api.core.setData(data);
const all={from:'2026-01-01',to:'2026-02-15'}, result=api.core.totals(all);
assert.equal(result.net,20002);assert.equal(result.paid.value,5000);assert.equal(result.sold.count,1);
assert.equal(result.sold.complete,false);
assert.equal(api.core.totals({from:'2026-01-15',to:'2026-01-31'}).net,null);
assert(api.render('summary',all,'ooo').includes('Нет отчёта'));
assert(api.render('summary',all,'ooo').includes('Месяц не закрыт'));
assert(api.render('payouts',all,'ooo').includes('Не сверено'));
assert(!api.render('stock',all,'ooo').includes('<script>unsafe'));
assert(api.render('stock',all,'ooo').includes('&lt;script&gt;unsafe'));
assert(api.render('stock',all,'ooo').includes('Не передаётся'));
assert(api.render('summary',all,'ip').includes('Ozon ИП ещё не подключён'));
const broken=structuredClone(data);broken.stocks.rows[0].reserved=20;assert(!api.core.validate(broken));
console.log('Ozon: totals, coverage, filtering, bank distinction, escaping and stock validation passed');
