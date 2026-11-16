const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /<a class="brand-home" href="#overview"[^>]*>MA Distribution<\/a>/);
assert.match(html.match(/<nav class="market-nav"[\s\S]*?<\/nav>/)[0], /href="#unit"/);

function dashboard(at, hash) {
  const nodes = Object.fromEntries(['screen', 'fresh-visible', 'fresh-more', 'freshness', 'page-context'].map(id => [id, {innerHTML: '', textContent: '', dataset: {}}]));
  const menu = {}, footer = {dataset: {}, textContent: 'Footer'};
  const listeners = {};
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [at])); } }
  const context = {console, Date: Clock, Intl, URLSearchParams, Event, Set, Map,
    location: {hostname: 'localhost', pathname: '/', hash, search: '?from=2026-11-01&to=2026-11-15&brand='},
    window: {scrollTo() {}, addEventListener(name, fn) { listeners[name] = fn; }},
    document: {getElementById(id) { return nodes[id] || null; }, querySelector(selector) { return selector === 'nav.menu' ? menu : selector === '.foot' ? footer : null; }, querySelectorAll() { return []; }},
    fetch: () => new Promise(() => {})};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('data.js', 'utf8'), context);
  const data = context.window.DASHBOARD;
  const amounts = JSON.stringify(data.months.map(r => [r.month, r.orderedKop, r.deliveredKop, r.realizationKop, r.payoutKop]));
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  assert.equal(JSON.stringify(data.months.map(r => [r.month, r.orderedKop, r.deliveredKop, r.realizationKop, r.payoutKop])), amounts);
  return {context, data, nodes, listeners};
}

const november = dashboard('2026-11-16T19:00:00Z', '#overview');
assert.equal(november.data.months.find(r => r.month === '2026-11').movementState, 'missing');
assert.equal(november.data.profit.months.find(r => r.month === '2026-11').view.status, 'missing');
assert.equal(november.data.months.find(r => r.month === '2026-12').movementState, 'future');
assert.match(november.nodes.screen.innerHTML, /Л’Этуаль: отчёты ещё не загружены/);
assert.match(november.nodes.screen.innerHTML, /28\.10\.2026/);
assert(!november.nodes['fresh-more'].textContent.includes('Ноябрь и декабрь ещё не наступили'));
november.context.location.hash = '#unit';
november.listeners.hashchange();
assert.match(november.nodes.screen.innerHTML, /Экономика одного товара/);
november.context.location.hash = '#overview';
november.listeners.hashchange();
assert.match(november.nodes.screen.innerHTML, /Бизнес на одном экране/);

const october = dashboard('2026-10-28T12:00:00Z', '#overview');
assert.equal(october.data.months.find(r => r.month === '2026-11').movementState, 'future');
const december = dashboard('2026-11-30T21:30:00Z', '#overview');
assert.equal(december.data.months.find(r => r.month === '2026-12').movementState, 'missing');
console.log('Dashboard: home and unit routes, November missing-data notice, Moscow month rollover, and unchanged financial amounts passed');
