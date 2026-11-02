const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const c={window:{},Intl,Date,BigInt,Number,Map,Set,structuredClone,fetch:()=>Promise.resolve({ok:false}),crypto:require('crypto').webcrypto,console};vm.createContext(c);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','purchases.js'),'utf8'),c);const api=c.window.PurchaseBook.core;
function order(id,entity,qty,price,shipping=0,date='2026-01-01'){return{id,entity,reference:id,supplier:'Supplier',date,receivedDate:date,status:'received',expectedDate:'',warehouse:'Main',currency:'RUB',rateUnits:10000,deliveryKop:shipping,allocation:'value',note:'',lines:[{sku:'SKU-X',name:'Product',brand:'Brand',qty,priceMinor:price}]};}
const a=order('a','ip',2,10000,5000),b=order('b','ip',3,20000,0,'2026-01-02');
assert.equal(api.cost(a).total,25000);assert.equal(api.cost(a).lines[0].unitKop,12500);
assert.deepEqual(Array.from(api.allocate(101,[1,1,1])),[34,34,33]);assert.equal(api.allocate(999,[1,3,7]).reduce((a,b)=>a+b,0),999);
assert.throws(()=>api.allocate(100,[0,0]),/количеству/);
let db={schemaVersion:1,orders:[a,b,order('ooo','ooo',4,10)],movements:[]};api.validate(db);let model=api.ledger(db),ip=model.stock.find(b=>b.entity==='ip');assert.equal(ip.qty,5);assert.equal(ip.valueKop,85000);assert.equal(ip.unitKop,17000);assert.equal(model.stock.length,2);
const move={id:'z',entity:'ip',warehouse:'Main',sku:'SKU-X',date:'2026-01-03',type:'issue',qty:2,target:'',note:''};db.movements.push(move);model=api.ledger(db);ip=model.stock.find(b=>b.entity==='ip');assert.equal(ip.qty,3);assert.equal(ip.valueKop,51000);assert.equal(model.history.find(h=>h.id==='z').costKop,34000);
db.movements.push({...move,id:'y',date:'2026-01-04',type:'transfer',qty:1,target:'Second'});db.movements.push({...move,id:'a',date:'2026-01-04',warehouse:'Second',qty:1});model=api.ledger(db);assert.equal(model.stock.filter(b=>b.entity==='ip').reduce((a,b)=>a+b.qty,0),2);assert.equal(model.stock.filter(b=>b.entity==='ip').reduce((a,b)=>a+b.valueKop,0),34000);
const before=JSON.stringify(db);assert.throws(()=>api.ledger({...db,movements:[...db.movements,{...move,id:'bad',qty:999}]}),/Недостаточно/);assert.equal(JSON.stringify(db),before);
assert.throws(()=>api.validate({...db,orders:[{...a,lines:[{...a.lines[0],qty:1}]},{...b,lines:[{...b.lines[0],qty:1}]}]}),/Недостаточно/);
assert.throws(()=>api.ledger({...db,movements:[{...move,date:'2025-12-01'}]}),/Недостаточно/);
let transit={...a,status:'transit'};assert.equal(api.ledger({orders:[transit],movements:[]}).stock.length,0);assert.equal(api.ledger({orders:[{...a,archived:true}],movements:[]}).stock[0].qty,2);
let foreign={...a,currency:'CNY',rateUnits:140000,deliveryKop:600,lines:[{...a.lines[0],qty:3,priceMinor:2000}]};assert.equal(api.cost(foreign).total,84600);assert.equal(api.cost(foreign).lines[0].unitKop,28200);
assert.equal(api.fixed('14,1234',4,'Курс'),141234);assert.throws(()=>api.fixed('1.234',2,'Цена'));
let full={schemaVersion:1,orders:[a],movements:[{...move,qty:2}]};assert.equal(api.ledger(full).stock[0].valueKop,0);
let voided={...full,movements:[{...move,qty:2,voided:true}]};assert.equal(api.ledger(voided).stock[0].qty,2);
let csv=api.stockCSV([{sku:'=1+1',name:'"Product"',brand:'b',entity:'ip',warehouse:'Main',qty:1,unitKop:100,valueKop:100}]);assert(csv.includes("'=1+1"));assert(csv.includes('""Product""'));
console.log('Passed: exact delivery allocation; currency conversion; weighted inventory; separate entities; planned/received/archive; same-day transfers; issues and cancellations; no negative stock or broken edits; backup validation; CSV safety.');


const draft={...order('draft','unknown',3,2000),status:'unconfirmed',warehouse:'',currency:'CNY',rateUnits:null,deliveryCurrency:'CNY',deliveryMinor:600,deliveryKop:null,sourceRevision:1};
api.validate({schemaVersion:1,orders:[draft],movements:[]});let unpriced=api.cost(draft);
assert.equal(unpriced.nativeGoodsMinor,6000);assert.equal(unpriced.nativeTotalMinor,6600);assert.equal(unpriced.total,null);assert.equal(unpriced.delivery,null);
assert.equal(api.ledger({orders:[draft],movements:[]}).stock.length,0);
assert.throws(()=>api.validate({schemaVersion:1,orders:[{...draft,status:'received'}],movements:[]}),/курс/);
const initial=api.mergeShared(null,draft);assert(initial.changed);assert.equal(api.mergeShared(initial.record,draft).changed,false);
const edited=structuredClone(initial.record);edited.note='My note';edited.entity='ooo';
const changed={...draft,sourceRevision:2,entity:'ip',rateUnits:140000};const merged=api.mergeShared(edited,changed);
assert.equal(merged.record.entity,'ooo');assert.equal(merged.record.note,'My note');assert.equal(merged.record.rateUnits,140000);assert.equal(merged.conflicts,1);
assert.equal(api.mergeShared(merged.record,draft).changed,false);
console.log('Passed: foreign-currency delivery without invented FX, owner or receipt; source revisions and preserved local edits.');

const pendingOwner={...draft,status:'received',rateUnits:140000,deliveryCurrency:'RUB',deliveryMinor:75000,expenses:[{date:'2026-01-01',label:'Freight',amountKop:70000},{date:'2026-01-01',label:'Handling',amountKop:5000}]};
api.validate({schemaVersion:1,orders:[pendingOwner],movements:[]});
const pendingStock=api.ledger({orders:[pendingOwner],movements:[]}).stock[0];
assert.equal(pendingStock.qty,3);assert.equal(pendingStock.entity,'unknown');assert.equal(pendingStock.valueKop,159000);
assert.throws(()=>api.validate({schemaVersion:1,orders:[{...pendingOwner,expenses:[{date:'2026-01-01',label:'Mismatch',amountKop:1}]}],movements:[]}),/Сумма расходов/);
console.log('Passed: actual receipt with unassigned owner; itemised expenses reconcile and are counted once.');
