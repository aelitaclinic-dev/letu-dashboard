const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');

const store = new Map();
const context = {
  window: {},
  Intl, Date, Number, Map, Set, structuredClone,
  fetch: () => new Promise(() => {}),
  crypto: require('crypto').webcrypto,
  console,
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, value)
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'wholesale-leads.js'), 'utf8'), context);
const api = context.window.WholesaleLeads.core;

const site = {
  form_id: 3,
  submission_id: '901',
  created_at: '2026-11-27 20:40:00',
  response: {
    input_text_1: 'Тест сайта',
    input_text: '+7 000 000-00-01',
    email: 'test-site@example.com',
    input_text_2: ''
  }
};
const first = api.ingestFluentForm(site);
const second = api.ingestFluentForm(site);
assert.equal(first.created, true);
assert.equal(second.created, false);
assert.equal(first.lead.id, second.lead.id);
assert.equal(first.lead.source, 'site');
assert.equal(first.lead.channel, 'form');
assert.equal(first.lead.stage, 'new');
assert.equal(first.lead.firstReplyAt, null);
assert.equal(first.lead.externalId, 'fluentform:3:901');
assert.match(api.cardHtml(first.lead), /Сайт/);
assert.match(api.cardHtml(first.lead), /Новая/);
assert.match(api.cardHtml(first.lead), /Форма прайса/);
assert.match(api.cardHtml(first.lead), /Ответа нет/);
assert.match(api.cardHtml(first.lead), /Тест сайта/);

assert.throws(() => api.ingestFluentForm({form_id: 4, submission_id: '1', created_at: '2026-11-27 20:40:00', response: {input_text_1: 'Чужая'}}), /форма прайса/);

const other = api.ingestFluentForm({
  form_id: '3',
  id: '902',
  created_at: '2026-11-27T20:41:00Z',
  response: {input_text_1: 'Второй салон', input_text: '+7 000 000-00-09', email: 'second@example.com', input_text_2: 'Салон Север'}
});
assert.equal(other.created, true);
assert.equal(other.lead.request, 'Прайс для Салон Север');
assert.equal(other.lead.source, 'site');

const messenger = api.leadFromDraft({
  id: 'manual-messenger',
  receivedLocal: '2026-11-27T23:45',
  name: 'Тест мессенджера',
  phone: '+7 000 000-00-02',
  email: '',
  request: 'Нужен прайс на кератин для салона',
  source: 'messenger',
  channel: 'telegram',
  referrer: 'не должен сохраниться'
});
assert.equal(messenger.source, 'messenger');
assert.equal(messenger.channel, 'telegram');
assert.equal(messenger.referrer, '');
assert.equal(messenger.stage, 'new');
assert.match(api.cardHtml(messenger), /Мессенджер/);
assert.match(api.cardHtml(messenger), /Telegram/);
assert.doesNotMatch(api.cardHtml(messenger), /Кто рекомендовал/);

const referral = api.leadFromDraft({
  id: 'manual-referral',
  receivedLocal: '2026-11-27T23:50',
  name: 'Тест рекомендации',
  phone: '+7 000 000-00-03',
  email: '',
  request: 'Хочет оптовый прайс',
  source: 'referral',
  channel: 'telegram',
  referrer: 'Катя'
});
assert.equal(referral.referrer, 'Катя');
assert.match(api.cardHtml(referral), /Рекомендация/);
assert.match(api.cardHtml(referral), /Кто рекомендовал/);
assert.match(api.cardHtml(referral), /Катя/);
assert.match(api.cardHtml(referral), /Telegram/);
assert.throws(() => api.leadFromDraft({
  id: 'manual-referral-empty',
  receivedLocal: '2026-11-27T23:51',
  name: 'Без рекомендателя',
  phone: '+7 000 000-00-04',
  email: '',
  request: 'Прайс',
  source: 'referral',
  channel: 'telegram',
  referrer: ' '
}), /кто рекомендовал/);

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wholesale-leads.json'), 'utf8'));
api.validate(seed);
assert.equal(seed.leads.length, 3);
assert.deepEqual(seed.leads.map(lead => lead.source), ['site', 'messenger', 'referral']);
assert.equal(api.absorb(seed), true);
assert.equal(api.absorb(seed), false);
const html = seed.leads.map(api.cardHtml).join('');
assert.match(html, /Сайт/);
assert.match(html, /Мессенджер/);
assert.match(html, /Рекомендация/);
assert.match(html, /data-source="site"/);
assert.match(html, /data-source="messenger"/);
assert.match(html, /data-source="referral"/);

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(index, /href="#leads"/);
assert.match(index, /wholesale-leads\.js/);
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.match(app, /hash === "leads"/);

console.log('Wholesale leads: form idempotency, messenger, referral, and shared list passed');
