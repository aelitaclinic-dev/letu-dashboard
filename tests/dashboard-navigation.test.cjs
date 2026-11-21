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
  vm.runInContext(fs.readFileSync('letu-finance.js', 'utf8'), context);
  const data = context.window.DASHBOARD;
  const amounts = JSON.stringify(data.months.map(r => [r.month, r.orderedKop, r.deliveredKop, r.realizationKop, r.payoutKop]));
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  assert.equal(JSON.stringify(data.months.map(r => [r.month, r.orderedKop, r.deliveredKop, r.realizationKop, r.payoutKop])), amounts);
  return {context, data, nodes, listeners};
}

const november = dashboard('2026-11-16T19:00:00Z', '#overview');
assert.equal(november.data.months.find(r => r.month === '2026-11').movementState, 'missing');
assert.equal(november.data.months.find(r => r.month === '2026-11').financeState, 'partial');
assert.equal(november.data.profit.months.find(r => r.month === '2026-11').view.partial, true);
assert.equal(november.data.months.find(r => r.month === '2026-12').movementState, 'future');
assert(!november.nodes.screen.innerHTML.includes('Л’Этуаль: отчёты ещё не загружены'));
assert.match(november.nodes.screen.innerHTML, /15\.11\.2026/);
assert(!november.nodes['fresh-more'].textContent.includes('Ноябрь и декабрь ещё не наступили'));
november.context.location.hash = '#unit';
november.listeners.hashchange();
assert.match(november.nodes.screen.innerHTML, /Экономика одного товара/);
november.context.location.hash = '#overview';
november.listeners.hashchange();
assert.match(november.nodes.screen.innerHTML, /Бизнес на одном экране/);

const december = dashboard('2026-11-30T21:30:00Z', '#overview');
assert.equal(december.data.months.find(r => r.month === '2026-12').movementState, 'missing');
const profit = dashboard('2026-11-21T12:00:00Z', '#profit');
const page = profit.nodes.screen.innerHTML;
const banner = page.slice(page.indexOf("id='profit-banner'"), page.indexOf("id='profit-chart'"));
assert.match(banner, /Чистая прибыль рассчитана за 1 из 11 месяцев/);
assert.match(banner, /12 974,38 ₽/);
assert.doesNotMatch(banner, /21 560/);
const octoberCard = page.slice(page.indexOf("id='profit-month-2026-10'"), page.indexOf("id='profit-month-2026-11'"));
assert.match(octoberCard, /data-profit-state='settled'/);
assert.match(octoberCard, /ЧИСТАЯ ПРИБЫЛЬ/);
assert.match(octoberCard, /Расчётная чистая прибыль/);
assert.match(octoberCard, /12 974,38 ₽/);
const novemberCard = page.slice(page.indexOf("id='profit-month-2026-11'"));
const novemberHero = novemberCard.slice(0, novemberCard.indexOf('<details'));
assert.match(novemberCard, /data-profit-state='open'/);
assert.match(novemberHero, /Расчёт не завершён/);
assert.match(novemberHero, /1–15 ноября, неполный месяц/);
assert.match(novemberHero, /нутритив250/);
assert.doesNotMatch(novemberHero, /21 560/);
assert.match(novemberCard, /Результат до неуточнённых расходов[\s\S]{0,80}21 560,70 ₽/);
assert.match(page, /id='profit-month-2026-09'[\s\S]{0,120}data-profit-state='open'/);
assert.equal((page.match(/data-profit-month='2026-10'/g) || []).length > 0, true);
assert.equal(page.includes("data-profit-month='2026-09'"), false);
profit.context.location.hash = '#profit/2026-01/2026-09';
profit.listeners.hashchange();
const early = profit.nodes.screen.innerHTML;
assert.match(early, /Рассчитано за 0 из 9 месяцев/);
assert.doesNotMatch(early, /profit-banner-amount/);
console.log('Dashboard: home and unit routes, November partial report, Moscow month rollover, and unchanged financial amounts passed');

