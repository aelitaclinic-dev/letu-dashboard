const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');

const store = new Map();
store.set('ma-distribution-wholesale-leads-v1', '[{"name":"секрет"}]');
const context = {
  window: {},
  Intl, Date, Number, Map, Set, structuredClone,
  fetch: () => { throw new Error('public page must not fetch leads'); },
  crypto: require('crypto').webcrypto,
  console,
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'wholesale-leads.js'), 'utf8'), context);
const api = context.window.WholesaleLeads.core;
assert.equal(store.has('ma-distribution-wholesale-leads-v1'), false);

const site = api.leadFromFluentForm({
  form_id: 3,
  submission_id: '901',
  created_at: '2026-11-27 20:40:00',
  response: {input_text_1: 'Тест сайта', input_text: '+7 000 000-00-01', email: 'test-site@example.com', input_text_2: ''}
});
assert.equal(site.source, 'site');
assert.equal(site.channel, 'form');
assert.equal(site.stage, 'new');
assert.equal(site.externalId, 'fluentform:3:901');
assert.equal(api.sourceLabel(site), 'Сайт');
assert.equal(api.channelLabel(site.channel), 'Форма сайта');

const leads = [];
const first = api.applyIncoming(leads, site);
const second = api.applyIncoming(leads, site);
assert.equal(first.created, true);
assert.equal(second.created, false);
assert.equal(leads.length, 1);
assert.equal(api.shouldNotify({created: true}), true);
assert.equal(api.shouldNotify({created: false, duplicate: true}), false);
assert.equal(api.shouldNotify({created: true, imported: true}), false);
assert.equal(api.shouldNotify({created: true, demo: true}), false);
assert.equal(api.shouldNotify({created: true, edited: true}), false);

const chat = api.applyIncoming(leads, api.normalize({
  id: 'chat-1', number: 0, conversationId: 'conv-7', receivedAt: '2026-11-27T21:00:00Z',
  name: 'Посетитель сайта', request: 'Первое сообщение', source: 'site', channel: 'site-chat', stage: 'new'
}));
assert.equal(chat.created, true);
assert.equal(chat.lead.source, 'site');
assert.equal(chat.lead.channel, 'site-chat');
const again = api.applyIncoming(leads, {
  conversationId: 'conv-7', receivedAt: '2026-11-27T21:05:00Z', request: 'Продолжение'
});
assert.equal(again.created, false);
assert.equal(leads.length, 2);
assert.equal(again.lead.history.at(-1).text, 'Продолжение');

const referral = api.normalize({
  id: 'manual-referral', number: 104, receivedAt: '2026-11-27T21:10:00+03:00',
  name: 'Тест рекомендации', phone: '+7 000 000-00-03', request: 'Хочет оптовый прайс',
  source: 'referral', channel: 'whatsapp', referrer: 'Кати', stage: 'new'
});
assert.equal(api.sourceLabel(referral), 'Рекомендация Кати');
assert.equal(api.channelLabel(referral.channel), 'WhatsApp');
assert.throws(() => api.normalize({
  id: 'bad', number: 1, receivedAt: '2026-11-27T21:10:00Z', name: 'Без рекомендателя',
  request: 'Прайс', source: 'referral', channel: 'telegram', referrer: ' ', stage: 'new'
}), /кто рекомендовал/);

const demo = api.demoLeads();
assert.equal(demo.length, 6);
const labels = demo.map(lead => api.channelLabel(lead.channel) + '|' + api.sourceLabel(lead));
assert.ok(labels.some(item => item.startsWith('Telegram|')));
assert.ok(labels.some(item => item.startsWith('Instagram|')));
assert.ok(labels.some(item => item.startsWith('WhatsApp|')));
assert.ok(labels.some(item => item.startsWith('MAX|')));
assert.ok(labels.some(item => item.includes('Форма сайта|Сайт')));
assert.ok(labels.some(item => item === 'WhatsApp|Рекомендация Кати'));
assert.equal(demo.some(lead => /@(?!example\.com)/.test(lead.email) && lead.email !== 'demo@example.com'), false);
assert.equal(api.fresh(demo[0]), true);
const many = [];
for (let i = 0; i < 16; i += 1) {
  many.push(api.normalize({
    id: 'n-' + i, number: i + 1, receivedAt: new Date(Date.UTC(2026, 10, 27, 10, i)).toISOString(),
    name: 'Клиент ' + i, request: 'Прайс', source: 'direct', channel: 'telegram', stage: 'new'
  }));
}
const listed = api.filtered(many, {channel: 'all', source: 'all', stage: 'all', waiting: false});
assert.equal(listed[0].number, 16);
const page = api.pageOf(listed, 1, 15);
assert.equal(page.rows.length, 15);
assert.equal(page.pages, 2);
assert.equal(api.pageOf(listed, 2, 15).rows.length, 1);
const waiting = api.filtered(demo, {channel: 'all', source: 'all', stage: 'all', waiting: true});
assert.ok(waiting.every(lead => !lead.firstReplyAt));

const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wholesale-leads.json'), 'utf8'));
assert.deepEqual(file.leads, []);
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(index, /href="https:\/\/maat-impera\.ru\/wholesale-leads\/"/);
assert.match(index, /wholesale-leads\.js\?v=20261128-leads-desk/);
assert.match(index, /localStorage\.removeItem\("ma-distribution-wholesale-leads-v1"\)/);
assert.match(index, /mount\(screen, \{demo: true\}\)/);
const source = fs.readFileSync(path.join(__dirname, '..', 'wholesale-leads.js'), 'utf8');
assert.doesNotMatch(source, /wp-json\/maat\/v1\/wholesale-leads/);
assert.match(source, /Демонстрационные данные/);
const php = fs.readFileSync(path.join(__dirname, '..', 'site-analytics/wordpress/maat-wholesale-leads/maat-wholesale-leads.php'), 'utf8');
assert.match(php, /permission_callback' => 'maat_wl_can'/);
assert.match(php, /Новая оптовая заявка/);
assert.doesNotMatch(php, /Access-Control-Allow-Origin/);

console.log('Wholesale leads: privacy, channels, paging, chat continuation, and notify rules passed');
