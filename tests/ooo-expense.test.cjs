const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const elements = {};
function el(id) {
  if (!elements[id]) elements[id] = { id: id, hidden: false, textContent: "", innerHTML: "", dataset: {}, classList: { toggle: function () {} }, setAttribute: function () {}, removeAttribute: function () {}, getAttribute: function () { return ""; } };
  return elements[id];
}
const navLinks = [{ href: "#expenses/ooo", getAttribute: function (name) { return name === "href" ? "#expenses/ooo" : ""; }, classList: { toggle: function () {} }, setAttribute: function () {}, removeAttribute: function () {} }];
const listeners = {};
const location = { hash: "#expenses/ooo", hostname: "localhost", pathname: "/", search: "" };
const window = {
  addEventListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  scrollTo: function () {},
};
const document = {
  getElementById: function (id) {
    if (["fresh-visible", "fresh-more", "screen", "page-context", "freshness"].indexOf(id) < 0) return null;
    return el(id);
  },
  querySelector: function (selector) {
    if (selector === "nav.menu") return el("menu");
    if (selector === ".foot") return el("foot");
    return null;
  },
  querySelectorAll: function (selector) {
    if (selector === ".market-nav a") return navLinks;
    return [];
  },
};
const context = {
  window: window,
  document: document,
  location: location,
  history: { pushState: function () {}, replaceState: function () {} },
  localStorage: { getItem: function () { return "[]"; }, setItem: function () {}, removeItem: function () {} },
  fetch: function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve(null); } }); },
  console: console,
  URLSearchParams: URLSearchParams,
  structuredClone: structuredClone,
};
context.window.window = context.window;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), context, { filename: "data.js" });
vm.runInContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), context, { filename: "app.js" });

const data = context.window.DASHBOARD;
const records = data.businessExpenses.records.filter(function (row) { return row.id === "decl-ooo-2026-11-11"; });
assert.strictEqual(records.length, 1, "Оплата декларации должна быть одной записью.");
const row = records[0];
assert.strictEqual(row.entity, "ooo");
assert.strictEqual(row.payerEntity, "ooo");
assert.strictEqual(row.beneficiaryEntity, "ooo");
assert.strictEqual(row.status, "paid");
assert.strictEqual(row.date, "2026-11-11");
assert.strictEqual(row.paidMonth, "2026-11");
assert.strictEqual(row.amountKop, 2300000);
assert.strictEqual(row.vatIncludedKop, 150467);
assert.strictEqual(row.currency, "RUB");
assert.strictEqual(row.category, "declarations");
assert.ok(row.goods.indexOf("Кератин") >= 0 && row.goods.indexOf("ботокс") >= 0);
assert.ok(row.document.indexOf("№ 11") >= 0 && row.document.indexOf("40755") >= 0);
assert.ok(row.payee.indexOf("ТЕХПРОМСЕРТ") >= 0);
assert.strictEqual(row.methodConfirmed, false);
assert.strictEqual(row.allocationMethod, null);
const ooo = data.businessExpenses.entities.find(function (item) { return item.id === "ooo"; });
assert.strictEqual(ooo.label, "ООО «КЛМ»");
assert.strictEqual(ooo.inn, "5003170916");
assert.strictEqual(ooo.kpp, "500301001");
assert.strictEqual(ooo.taxRate, null);
const paidOoo = data.businessExpenses.records.filter(function (item) {
  return item.entity === "ooo" && item.status === "paid" && item.paidMonth >= "2026-01" && item.paidMonth <= "2026-11";
});
assert.strictEqual(paidOoo.length, 3);
assert.strictEqual(paidOoo.reduce(function (sum, item) { return sum + item.amountKop; }, 0), 6900000);
assert.strictEqual(data.profit.registers.septemberCashKop, 4600000);
assert.strictEqual(data.profit.registers.novemberCashKop, 2300000);

const html = elements.screen.innerHTML;
assert.ok(html.indexOf("ООО «КЛМ»") >= 0, "В отчёте должно быть название ООО «КЛМ».");
assert.ok(html.indexOf("ИНН 5003170916") >= 0);
assert.ok(html.indexOf("Новая оплата") >= 0);
assert.ok(html.indexOf("23 000 ₽") >= 0);
assert.ok(html.indexOf("69 000 ₽") >= 0, "Итог оплат ООО за январь–ноябрь включает две сентябрьские декларации и эту.");
assert.ok(html.indexOf("11.11.2026") >= 0);
assert.ok(html.indexOf("Платёжное поручение № 11") >= 0);
assert.ok(html.indexOf("Кератин, ботокс") >= 0);
assert.ok(html.indexOf("1 504,67 ₽") >= 0);
assert.ok(html.indexOf("24 504") < 0, "НДС поставщика не прибавляется к 23 000 ₽.");
assert.ok(html.indexOf("Декларация соответствия, первая") >= 0);
assert.ok(html.indexOf("Сертификат") >= 0);
assert.ok(html.indexOf("id='expense-decl-ooo-2026-11-11'") >= 0);
assert.ok(html.indexOf("Декларация соответствия, первая") > html.indexOf("Расходы бизнеса"));
assert.strictEqual(elements["page-context"].textContent, "Расходы ООО «КЛМ» и ИП · раздельный учёт");

location.hash = "#profit";
listeners.hashchange.forEach(function (fn) { fn(); });
const profit = elements.screen.innerHTML;
assert.ok(profit.indexOf("п/п 11, счёт 40755") >= 0);
assert.ok(profit.indexOf("Оплата декларации ООО «КЛМ» 11.11.2026: 23 000 ₽") >= 0);
assert.ok(profit.indexOf("Оплата двух деклараций ООО в сентябре 2026: 46 000 ₽") >= 0);
assert.ok(profit.indexOf("Из прибыли ИП и из результата Л’Этуаль эта сумма не вычитается.") >= 0);

console.log("Passed: OOO KLM declaration payment of 23 000 ₽ on 11.11.2026 is in the expense report, and supplier VAT stays inside that sum.");
