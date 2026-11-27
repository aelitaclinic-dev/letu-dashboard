/* Wholesale inquiries. Public #leads is a fictional demo. Real cards stay on the site after login. */
(function () {
  'use strict';
  const OLD_KEY = 'ma-distribution-wholesale-leads-v1';
  const WORK_URL = 'https://maat-impera.ru/wholesale-leads/';
  const CHANNELS = {
    telegram: 'Telegram', instagram: 'Instagram', whatsapp: 'WhatsApp', max: 'MAX',
    form: 'Форма сайта', 'site-chat': 'Чат на сайте'
  };
  const SOURCES = {site: 'Сайт', social: 'Соцсеть', referral: 'Рекомендация', direct: 'Прямое обращение', unknown: 'Неизвестно'};
  const STAGES = {new: 'Новая', progress: 'Взят в работу', qualified: 'Квал-лид', closed: 'Закрыта'};
  const REVIEWS = {inbox: 'Входящие', review: 'На проверке', spam: 'Спам'};
  const PAGE = 15;
  const state = {
    demo: true, leads: [], editor: false, error: '', message: '', tab: 'inbox',
    filters: {channel: 'all', source: 'all', stage: 'all', waiting: false},
    page: 1, openId: '', api: '', nonce: ''
  };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  function fail(text) { throw new Error(text); }
  function text(v, max) {
    if (v == null) return '';
    if (typeof v !== 'string') fail('Текст имеет неверный формат.');
    const value = v.trim();
    if (value.length > max) fail('Текст слишком длинный.');
    return value;
  }
  function parseReceived(value) {
    let raw = value;
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
    if (typeof raw !== 'string' || !raw.trim()) fail('Укажите дату обращения.');
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) fail('Проверьте дату обращения.');
    return date.toISOString();
  }
  function stamp(iso) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      }).format(new Date(iso));
    } catch (error) {
      return 'нет даты';
    }
  }
  function moscowLocal(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day') + 'T' + get('hour') + ':' + get('minute');
  }
  function sourceLabel(lead) {
    if (!lead || lead.source === 'unknown' || !SOURCES[lead.source]) return 'Неизвестно';
    if (lead.source === 'referral') return 'Рекомендация ' + text(String(lead.referrer || ''), 240);
    return SOURCES[lead.source];
  }
  function channelLabel(channel) { return CHANNELS[channel] || 'Неизвестно'; }
  function clientLabel(lead) { return lead.name || lead.phone || lead.email || 'Без имени'; }
  function fresh(lead) { return lead.stage === 'new' && !lead.firstReplyAt && lead.review === 'inbox'; }
  function digits(value) { return String(value || '').replace(/\D/g, ''); }
  function hasLink(value) { return /https?:\/\/|www\.|\b[a-z0-9-]{3,}\.(com|ru|net|org|info|xyz|top|shop|online)\b/i.test(String(value || '')); }
  function gibberish(value) {
    const raw = String(value || '').trim();
    const chars = raw.match(/[A-Za-zА-Яа-яЁё]/g) || [];
    if (raw.length < 5 || chars.length < 5) return false;
    if (/[А-Яа-яЁё]/.test(raw) && !hasLink(raw)) return false;
    const vowels = (raw.match(/[aeiouyAEIOUY]/g) || []).length;
    const ratio = vowels / chars.length;
    return ratio < 0.28 || (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(raw) && ratio < 0.4);
  }
  function companyOf(lead) {
    const request = String(lead && lead.request || '');
    return request.indexOf('Прайс для ') === 0 ? request.slice('Прайс для '.length).trim() : '';
  }
  function topical(lead) {
    const request = String(lead.request || '');
    const company = companyOf(lead);
    const topic = /прайс|цен[аыуе]|сколько\s+стоит|опт|заказ|сотруднич|салон|кератин|fm\s*free|набор|условия|дилер|дистриб|закуп|товар|мастер/i;
    if (request.indexOf('Прайс для ') === 0) return !company || (!hasLink(company) && !gibberish(company));
    return topic.test(request);
  }
  function isTestLead(lead) {
    const blob = [lead.name, lead.email, lead.phone, lead.request].join(' ').toLowerCase();
    return /example\.com/.test(blob) || /тест|проверк/.test(blob) || /\+7\s*000\s*000/.test(String(lead.phone || '')) || /7000000/.test(digits(lead.phone));
  }
  function massMail(lead) {
    return /seo|backlink|крипт|casino|казино|viagra|займ|unsubscribe|накрут|продвижен|forex|порно|розыгрыш/i.test([lead.name, lead.request, companyOf(lead)].join(' '));
  }
  function reviewGroups(leads) {
    const burst = new Set();
    const duplicate = new Set();
    const buckets = new Map();
    leads.forEach((lead, index) => {
      const email = String(lead.email || '').trim().toLowerCase();
      const phone = digits(lead.phone);
      const keys = [];
      if (email && !email.endsWith('example.com')) keys.push('e:' + email);
      if (phone.length >= 10 && phone.indexOf('0000000') === -1) keys.push('p:' + phone.slice(-10));
      keys.forEach(key => {
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      });
    });
    buckets.forEach(indexes => {
      const ordered = indexes.slice().sort((a, b) => String(leads[a].receivedAt).localeCompare(String(leads[b].receivedAt)));
      const clusters = [];
      let cluster = [ordered[0]];
      for (let i = 1; i < ordered.length; i += 1) {
        const delta = new Date(leads[ordered[i]].receivedAt) - new Date(leads[cluster[0]].receivedAt);
        if (delta <= 10 * 60 * 1000) cluster.push(ordered[i]);
        else { clusters.push(cluster); cluster = [ordered[i]]; }
      }
      clusters.push(cluster);
      clusters.forEach(group => {
        if (group.length < 2) return;
        const names = new Set(group.map(i => String(leads[i].name || '').trim().toLowerCase()));
        const texts = new Set(group.map(i => (companyOf(leads[i]) || String(leads[i].request || '')).trim().toLowerCase()));
        if (names.size === 1 && texts.size <= 1) group.slice(1).forEach(i => duplicate.add(i));
        else group.forEach(i => burst.add(i));
      });
    });
    return {burst, duplicate};
  }
  function classifyAll(leads) {
    const groups = reviewGroups(leads);
    return leads.map((lead, index) => {
      if (lead.reviewSource === 'manual' && REVIEWS[lead.review]) return Object.assign({}, lead);
      const signs = [];
      const blob = [lead.name, lead.request, companyOf(lead)].join(' ');
      if (hasLink(blob)) signs.push('незапрошенная ссылка');
      if (gibberish(lead.name) || gibberish(companyOf(lead))) signs.push('бессвязный текст');
      if (massMail(lead) && !topical(lead)) signs.push('массовая рассылка');
      if (lead.automated) signs.push('автоматическая отправка');
      if (groups.burst.has(index)) signs.push('серия похожих отправок');
      const other = signs.filter(sign => sign !== 'серия похожих отправок');
      let review = 'review';
      let reason = 'Запрос трудно понять';
      if (isTestLead(lead)) {
        review = topical(lead) ? 'inbox' : 'review';
        reason = 'Тестовая запись';
      } else if (signs.indexOf('массовая рассылка') !== -1 && !topical(lead)) {
        review = 'spam';
        reason = 'Массовая рассылка без запроса по продукции';
      } else if (signs.indexOf('автоматическая отправка') !== -1 && !topical(lead)) {
        review = 'spam';
        reason = 'Подтверждённая автоматическая отправка';
      } else if (groups.burst.has(index) && (other.length >= 1 || !topical(lead))) {
        review = 'spam';
        reason = 'Серия заявок с несколькими признаками спама';
      } else if (groups.duplicate.has(index)) {
        review = topical(lead) ? 'inbox' : 'review';
        reason = 'Повтор той же отправки';
      } else if (topical(lead) && signs.length === 0) {
        review = 'inbox';
        reason = 'Понятный запрос по продукции, цене, опту или сотрудничеству';
      } else if (topical(lead)) {
        review = 'review';
        reason = 'Запрос по делу, есть подозрительный признак: ' + signs[0];
      }
      return Object.assign({}, lead, {
        review, reviewReason: reason, reviewSource: 'auto',
        reportExclude: isTestLead(lead) ? 'test' : (groups.duplicate.has(index) ? 'duplicate' : '')
      });
    });
  }
  function setReview(lead, review) {
    const reasons = {inbox: lead.review === 'spam' ? 'Возвращено во входящие вручную' : 'Подтверждено вручную', spam: 'Отмечено как спам вручную', review: 'Оставлено на проверке вручную'};
    return Object.assign({}, lead, {review, reviewSource: 'manual', reviewReason: reasons[review] || 'Решение менеджера'});
  }
  function reportOf(leads) {
    const report = {leads: 0, review: 0, qualified: 0};
    leads.forEach(lead => {
      if (lead.reportExclude === 'test' || lead.reportExclude === 'duplicate' || lead.review === 'spam') return;
      if (lead.review === 'review') report.review += 1;
      if (lead.review === 'inbox') {
        report.leads += 1;
        if (lead.stage === 'qualified') report.qualified += 1;
      }
    });
    return report;
  }
  function normalize(draft) {
    const history = Array.isArray(draft.history) ? draft.history.slice(0, 50).map(item => ({
      at: parseReceived(item.at),
      kind: text(String(item.kind || 'note'), 40),
      text: text(String(item.text || ''), 2000)
    })) : [];
    const lead = {
      id: text(String(draft.id || ''), 80),
      number: Number(draft.number) || 0,
      externalId: text(String(draft.externalId || ''), 120),
      conversationId: text(String(draft.conversationId || ''), 120),
      receivedAt: parseReceived(draft.receivedAt),
      name: text(String(draft.name || ''), 240),
      phone: text(String(draft.phone || ''), 80),
      email: text(String(draft.email || ''), 240),
      request: text(String(draft.request || ''), 500),
      source: draft.source || 'unknown',
      channel: draft.channel,
      referrer: text(String(draft.referrer || ''), 240),
      stage: draft.stage || 'new',
      firstReplyAt: draft.firstReplyAt ? parseReceived(draft.firstReplyAt) : null,
      notifyStatus: text(String(draft.notifyStatus || ''), 40),
      review: REVIEWS[draft.review] ? draft.review : '',
      reviewReason: text(String(draft.reviewReason || ''), 240),
      reviewSource: draft.reviewSource === 'manual' ? 'manual' : 'auto',
      reportExclude: draft.reportExclude === 'test' || draft.reportExclude === 'duplicate' ? draft.reportExclude : '',
      automated: !!draft.automated,
      history
    };
    if (!lead.id) fail('Неверный идентификатор заявки.');
    if (!CHANNELS[lead.channel]) fail('Укажите канал связи.');
    if (!SOURCES[lead.source]) fail('Укажите источник заявки.');
    if (!STAGES[lead.stage]) fail('Укажите стадию заявки.');
    if (!lead.request) fail('Укажите краткий запрос.');
    if (lead.channel !== 'site-chat' && !lead.name && !lead.phone && !lead.email) fail('Укажите контакт: имя или телефон.');
    if (lead.source === 'referral' && !lead.referrer) fail('Укажите, кто рекомендовал.');
    if (lead.source !== 'referral') lead.referrer = '';
    if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) fail('Проверьте почту.');
    if (!Number.isInteger(lead.number) || lead.number < 0 || lead.number > 1000000) fail('Неверный номер заявки.');
    return lead;
  }
  function shouldNotify(event, lead) {
    if (!event || !lead || event.imported || event.demo || event.duplicate || event.edited || event.archive) return false;
    if (lead.review !== 'inbox' || lead.reportExclude === 'test' || lead.reportExclude === 'duplicate') return false;
    if (lead.notifyStatus === 'sent') return false;
    return !!(event.confirmed || event.created);
  }
  function leadFromFluentForm(payload) {
    if (!payload || typeof payload !== 'object') fail('Пустая отправка формы.');
    const formId = String(payload.form_id != null ? payload.form_id : (payload.formId != null ? payload.formId : ''));
    if (formId !== '3') fail('Это не форма прайса № 3.');
    const submissionId = String(payload.submission_id != null ? payload.submission_id : (payload.id != null ? payload.id : '')).trim();
    if (!submissionId || submissionId.length > 40 || !/^[A-Za-z0-9_-]+$/.test(submissionId)) fail('У отправки нет номера.');
    const response = payload.response && typeof payload.response === 'object' ? payload.response : {};
    const company = text(String(response.input_text_2 || response.company || ''), 240);
    return normalize({
      id: 'ff3-' + submissionId,
      externalId: 'fluentform:3:' + submissionId,
      receivedAt: payload.created_at || payload.receivedAt,
      name: text(String(response.input_text_1 || response.name || ''), 240),
      phone: text(String(response.input_text || response.phone || ''), 80),
      email: text(String(response.email || ''), 240),
      request: company ? text('Прайс для ' + company, 500) : 'Запрос оптового прайса',
      source: 'site', channel: 'form', referrer: '', stage: 'new', firstReplyAt: null
    });
  }
  function applyIncoming(leads, incoming) {
    const conversationId = text(String(incoming.conversationId || ''), 120);
    if (conversationId) {
      const found = leads.find(item => item.conversationId === conversationId);
      if (found) {
        found.history.push({at: parseReceived(incoming.receivedAt || new Date().toISOString()), kind: 'message', text: text(String(incoming.request || ''), 2000)});
        return {created: false, lead: found};
      }
    }
    const externalId = text(String(incoming.externalId || ''), 120);
    if (externalId) {
      const found = leads.find(item => item.externalId === externalId);
      if (found) return {created: false, lead: found};
    }
    const lead = normalize(Object.assign({}, incoming, {history: incoming.history || []}));
    leads.push(lead);
    return {created: true, lead};
  }
  function demoLeads() {
    const rows = [
      ['demo-106', 106, '2026-11-27T21:20:00Z', 'Марина Соколова', 'whatsapp', 'referral', 'Кати', 'Нужен прайс для салона', 'new', null, ''],
      ['demo-105', 105, '2026-11-27T21:05:00Z', 'Ольга Берег', 'form', 'site', '', 'Запрос оптового прайса', 'new', null, ''],
      ['demo-104', 104, '2026-11-27T20:40:00Z', 'Иван Лес', 'max', 'unknown', '', 'Сколько стоит набор', 'new', null, ''],
      ['demo-103', 103, '2026-11-27T18:10:00Z', 'Кира Новак', 'instagram', 'social', '', 'Прайс для мастера', 'new', '2026-11-27T15:40:00Z', ''],
      ['demo-102', 102, '2026-11-27T16:30:00Z', 'Павел Шум', 'telegram', 'social', '', 'Опт на кератин', 'new', null, ''],
      ['demo-101', 101, '2026-11-27T14:15:00Z', 'Ева Мост', 'whatsapp', 'direct', '', 'Условия для магазина', 'progress', '2026-11-27T12:00:00Z', ''],
      ['demo-108', 108, '2026-11-27T21:28:00Z', 'Ника Рощ', 'instagram', 'social', '', 'Прайс? Смотрите https://sample.test/offer', 'new', null, ''],
      ['demo-107', 107, '2026-11-27T21:26:00Z', 'Глеб Тихий', 'telegram', 'unknown', '', 'ывапртолджэывапр', 'new', null, ''],
      ['demo-203', 203, '2026-11-27T21:32:00Z', 'Zxcvbnmq', 'form', 'unknown', '', 'qwxzplmnv', 'new', null, 'spam-run@sample.test'],
      ['demo-202', 202, '2026-11-27T21:31:30Z', 'Qwrtmnzx', 'form', 'unknown', '', 'qwxzplmnv', 'new', null, 'spam-run@sample.test'],
      ['demo-201', 201, '2026-11-27T21:31:00Z', 'Xkplmqwr', 'form', 'unknown', '', 'qwxzplmnv', 'new', null, 'spam-run@sample.test']
    ];
    return classifyAll(rows.map(row => normalize({
      id: row[0], number: row[1], receivedAt: row[2], name: row[3], phone: '+7 900 000-00-' + String(row[1]).slice(-2), email: row[10] || ('demo-' + row[1] + '@sample.test'),
      channel: row[4], source: row[5], referrer: row[6], request: row[7], stage: row[8], firstReplyAt: row[9],
      history: [{at: row[2], kind: 'message', text: row[7]}]
    })));
  }
  function filtered(leads, filters) {
    return leads.filter(lead => {
      if (filters.tab && lead.review !== filters.tab) return false;
      if (filters.channel !== 'all' && lead.channel !== filters.channel) return false;
      if (filters.source !== 'all' && lead.source !== filters.source) return false;
      if (filters.stage !== 'all' && lead.stage !== filters.stage) return false;
      if (filters.waiting && lead.firstReplyAt) return false;
      return true;
    }).slice().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.number - a.number);
  }
  function pageOf(leads, page, size) {
    const total = leads.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(page, 1), pages);
    const start = (current - 1) * size;
    return {rows: leads.slice(start, start + size), page: current, pages, total, from: total ? start + 1 : 0, to: Math.min(start + size, total)};
  }
  function select(name, map, current, allLabel) {
    const titles = {channel: 'Канал', source: 'Источник', stage: 'Стадия'};
    const keys = Object.keys(map);
    return '<label>' + esc(titles[name] || name) + '<select name="' + esc(name) + '">'
      + (allLabel ? '<option value="all"' + (current === 'all' ? ' selected' : '') + '>' + esc(allLabel) + '</option>' : '')
      + keys.map(key => '<option value="' + esc(key) + '"' + (key === current ? ' selected' : '') + '>' + esc(map[key]) + '</option>').join('')
      + '</select></label>';
  }
  function detail(lead) {
    const history = (lead.history || []).map(item => '<li>' + esc(stamp(item.at)) + ' — ' + esc(item.text || item.kind) + '</li>').join('') || '<li>Истории пока нет.</li>';
    const reply = lead.firstReplyAt
      ? '<p class="wl-answered">Ответ отправлен ' + esc(stamp(lead.firstReplyAt)) + '</p>'
      : (state.demo ? '<p class="wl-unanswered">Ответа нет</p>' : '<button type="button" class="pb-outline" data-reply="' + esc(lead.id) + '">Ответ отправлен</button>');
    const notice = state.demo ? '' : (lead.notifyStatus === 'error'
      ? '<p class="wl-unanswered">Уведомление в MAX не ушло. Повтор доступен в настройках сайта.</p>'
      : (lead.notifyStatus === 'sent' ? '<p class="wl-answered">Уведомление в MAX отправлено.</p>' : ''));
    const decisions = lead.review === 'spam'
      ? '<button type="button" data-decision="inbox" data-id="' + esc(lead.id) + '">Вернуть во входящие</button>'
      : (lead.review === 'review'
        ? '<button type="button" data-decision="inbox" data-id="' + esc(lead.id) + '">Подтвердить заявку</button><button type="button" data-decision="spam" data-id="' + esc(lead.id) + '">В спам</button>'
        : '<button type="button" data-decision="spam" data-id="' + esc(lead.id) + '">В спам</button>');
    const stages = state.demo ? '' : '<p class="wl-actions">' + Object.keys(STAGES).filter(key => key !== 'closed').map(key => '<button type="button" data-stage="' + key + '" data-id="' + esc(lead.id) + '">' + esc(STAGES[key]) + '</button>').join('') + '</p>';
    return '<div class="wl-detail"><p>Телефон: ' + esc(lead.phone || 'не указан') + '</p><p>Почта: ' + esc(lead.email || 'не указана') + '</p>'
      + notice
      + '<p>Проверка: ' + esc(REVIEWS[lead.review] || 'Входящие') + '. ' + esc(lead.reviewReason || '') + '</p>'
      + '<p class="wl-actions">' + decisions + '</p>'
      + stages
      + '<p>Запрос: ' + esc(lead.request) + '</p>'
      + (lead.source === 'referral' ? '<p>Кто рекомендовал: ' + esc(lead.referrer) + '</p>' : '')
      + reply + '<p>История</p><ul>' + history + '</ul></div>';
  }
  function rowCells(lead) {
    const reply = lead.firstReplyAt ? esc(stamp(lead.firstReplyAt)) : '<span class="wl-unanswered">Ответа нет</span>';
    return '<td>' + esc(stamp(lead.receivedAt)) + '</td><td>' + esc(clientLabel(lead)) + '</td><td>' + esc(channelLabel(lead.channel)) + '</td><td>' + esc(sourceLabel(lead)) + '</td>'
      + '<td class="wl-ellipsis">' + esc(lead.request) + '</td><td>' + esc(STAGES[lead.stage]) + '</td><td>' + reply + '</td>';
  }
  function tableHtml(rows) {
    const body = rows.map(lead => {
      const open = state.openId === lead.id;
      return '<tr class="' + (fresh(lead) ? 'wl-fresh' : '') + '" data-open="' + esc(lead.id) + '" data-channel="' + esc(lead.channel) + '" data-source="' + esc(lead.source) + '">' + rowCells(lead) + '</tr>'
        + (open ? '<tr class="wl-open"><td colspan="7">' + detail(lead) + '</td></tr>' : '');
    }).join('');
    return '<div class="wl-desk"><table class="wl-table"><thead><tr><th>Время</th><th>Клиент</th><th>Канал</th><th>Источник</th><th>Запрос</th><th>Стадия</th><th>Первый ответ</th></tr></thead><tbody>'
      + (body || '<tr><td colspan="7">Заявок по этому фильтру нет.</td></tr>') + '</tbody></table></div>';
  }
  function cardsHtml(rows) {
    return '<div class="wl-m">' + (rows.map(lead => {
      const open = state.openId === lead.id;
      return '<article class="wl-mini' + (fresh(lead) ? ' wl-fresh' : '') + '" data-channel="' + esc(lead.channel) + '"><button type="button" data-open="' + esc(lead.id) + '"><b>' + esc(clientLabel(lead)) + '</b><span>' + esc(channelLabel(lead.channel)) + '</span><span>' + esc(STAGES[lead.stage]) + '</span><time>' + esc(stamp(lead.receivedAt)) + '</time></button>'
        + (open ? detail(lead) : '') + '</article>';
    }).join('') || '<p>Заявок по этому фильтру нет.</p>') + '</div>';
  }
  function editorHtml() {
    if (!state.editor || state.demo) return '';
    return '<form id="wl-form" class="wl-form"><div class="pb-form-grid">'
      + '<label>Дата обращения<input name="received" type="datetime-local" required value="' + esc(moscowLocal(new Date())) + '"></label>'
      + '<label>Имя<input name="name" maxlength="240" placeholder="Имя клиента"></label>'
      + '<label>Телефон<input name="phone" maxlength="80" placeholder="+7 000 000-00-00"></label>'
      + '<label>Почта<input name="email" maxlength="240"></label>'
      + select('channel', CHANNELS, 'telegram', '')
      + select('source', SOURCES, 'direct', '')
      + '<label>Кто рекомендовал<input name="referrer" maxlength="240" placeholder="Катя"></label>'
      + '</div><label>Запрос<textarea name="request" required maxlength="500"></textarea></label>'
      + '<p id="wl-form-error" class="pb-error" role="alert"></p><button class="pb-primary" type="submit">Сохранить заявку</button></form>';
  }
  function view() {
    const rows = filtered(state.leads, Object.assign({tab: state.tab}, state.filters));
    const tally = {inbox: 0, review: 0, spam: 0};
    state.leads.forEach(lead => { if (tally[lead.review] != null) tally[lead.review] += 1; });
    const report = reportOf(state.leads);
    const tabs = '<div class="wl-tabs">' + Object.keys(REVIEWS).map(key => '<button type="button" data-tab="' + key + '"' + (state.tab === key ? ' class="on"' : '') + '>' + esc(REVIEWS[key]) + ' <b>' + tally[key] + '</b></button>').join('') + '</div>';
    const slice = pageOf(rows, state.page, PAGE);
    const pager = '<div class="wl-pager"><button type="button" data-page="' + (slice.page - 1) + '"' + (slice.page === 1 ? ' disabled' : '') + '>Назад</button><span>' + slice.from + '–' + slice.to + ' из ' + slice.total + '</span><button type="button" data-page="' + (slice.page + 1) + '"' + (slice.page === slice.pages ? ' disabled' : '') + '>Дальше</button></div>';
    const banner = state.demo
      ? '<p class="wl-demo">Демонстрационные данные. Это не реальные клиенты. <a href="' + WORK_URL + '">Рабочий раздел после входа</a></p>'
      : '<p class="wl-work-note">Рабочие заявки хранятся на сайте и открываются после входа.</p>';
    return '<div class="pb-page wl-page" id="wl-root"><div class="wl-head"><div><p class="market-eyebrow">MAAT DISTRIBUTION / SINKO STYLING</p><h2>Входящие оптовые заявки</h2></div>'
      + (state.demo ? '' : '<button class="pb-primary" type="button" data-action="new-lead">＋ Добавить заявку</button>') + '</div>'
      + banner
      + (state.message ? '<p class="pb-message" role="status">' + esc(state.message) + '</p>' : '')
      + (state.error ? '<p class="pb-error" role="alert">' + esc(state.error) + '</p>' : '')
      + tabs
      + '<p class="wl-report">В отчёте по лидам: ' + report.leads + '. На проверке: ' + report.review + ' — до решения менеджера. Квал-лиды: ' + report.qualified + '. Спам, тесты и повторы в это число не входят.</p>'
      + '<form class="wl-filters" id="wl-filters">'
      + select('channel', CHANNELS, state.filters.channel, 'Все каналы')
      + select('source', SOURCES, state.filters.source, 'Все источники')
      + select('stage', STAGES, state.filters.stage, 'Все стадии')
      + '<label class="wl-check"><input type="checkbox" name="waiting"' + (state.filters.waiting ? ' checked' : '') + '> Без ответа</label></form>'
      + editorHtml() + tableHtml(slice.rows) + cardsHtml(slice.rows) + pager + '</div>';
  }
  function show() {
    const root = document.getElementById('wl-root');
    const html = view();
    if (root && root.parentElement) root.outerHTML = html;
    else if (state.container) state.container.innerHTML = html;
    bind(document.getElementById('wl-root'));
  }
  function bind(root) {
    const filters = root.querySelector('#wl-filters');
    filters.onchange = () => {
      const data = new FormData(filters);
      state.filters = {channel: String(data.get('channel') || 'all'), source: String(data.get('source') || 'all'), stage: String(data.get('stage') || 'all'), waiting: !!filters.elements.waiting.checked};
      state.page = 1;
      show();
    };
    root.addEventListener('click', event => {
      const open = event.target.closest('[data-open]');
      const page = event.target.closest('[data-page]');
      const button = event.target.closest('button');
      const tab = event.target.closest('[data-tab]');
      if (tab) { state.tab = tab.dataset.tab; state.page = 1; state.openId = ''; show(); return; }
      if (page && !page.disabled) { state.page = Number(page.dataset.page); show(); return; }
      if (button && button.dataset.action === 'new-lead') { state.editor = !state.editor; show(); return; }
      if (button && button.dataset.decision) { decide(button.dataset.id, button.dataset.decision); return; }
      if (button && button.dataset.stage) { setStage(button.dataset.id, button.dataset.stage); return; }
      if (button && button.dataset.reply) { markReply(button.dataset.reply); return; }
      if (open && event.target.tagName !== 'A') { state.openId = state.openId === open.dataset.open ? '' : open.dataset.open; show(); }
    });
    const form = root.querySelector('#wl-form');
    if (!form) return;
    form.onsubmit = event => {
      event.preventDefault();
      saveManual(form).catch(error => { const slot = root.querySelector('#wl-form-error'); if (slot) slot.textContent = error.message; });
    };
  }
  function draftFrom(form) {
    const received = form.elements.received.value;
    return normalize({
      id: 'tmp', number: 0,
      receivedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(received) ? received + ':00+03:00' : received,
      name: form.elements.name.value, phone: form.elements.phone.value, email: form.elements.email.value,
      request: form.elements.request.value, channel: form.elements.channel.value, source: form.elements.source.value,
      referrer: form.elements.referrer.value, stage: 'new', firstReplyAt: null
    });
  }
  function saveManual(form) {
    const draft = draftFrom(form);
    draft.id = '';
    return fetch(state.api, {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-WP-Nonce': state.nonce},
      body: JSON.stringify(draft)
    }).then(response => response.json().then(data => ({ok: response.ok, data}))).then(result => {
      if (!result.ok) fail((result.data && result.data.message) || 'Не удалось сохранить заявку.');
      state.editor = false;
      state.message = 'Заявка № ' + result.data.lead.number + ' сохранена.';
      return load();
    });
  }
  function decide(id, review) {
    if (!REVIEWS[review]) return;
    if (state.demo) {
      state.leads = state.leads.map(lead => lead.id === id ? setReview(lead, review) : lead);
      state.tab = review === 'inbox' ? 'inbox' : state.tab;
      state.message = review === 'inbox' ? 'Заявка возвращена во входящие.' : 'Заявка отмечена как спам.';
      show();
      return;
    }
    fetch(state.api + '/' + encodeURIComponent(id) + '/review', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-WP-Nonce': state.nonce},
      body: JSON.stringify({review})
    }).then(() => load());
  }
  function setStage(id, stage) {
    if (state.demo || !STAGES[stage]) return;
    fetch(state.api + '/' + encodeURIComponent(id) + '/stage', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-WP-Nonce': state.nonce},
      body: JSON.stringify({stage})
    }).then(() => load());
  }
  function markReply(id) {
    if (state.demo) return;
    fetch(state.api + '/' + encodeURIComponent(id) + '/reply', {
      method: 'POST', credentials: 'same-origin', headers: {'X-WP-Nonce': state.nonce}
    }).then(() => load());
  }
  function load() {
    return fetch(state.api, {credentials: 'same-origin', headers: {'X-WP-Nonce': state.nonce}})
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Нужен вход на сайт.')))
      .then(data => { state.leads = (data.leads || []).map(normalize); show(); });
  }
  function mount(container, options) {
    options = options || {};
    state.demo = options.demo !== false;
    state.api = options.api || '';
    state.nonce = options.nonce || '';
    state.container = container;
    state.leads = state.demo ? demoLeads() : [];
    state.page = 1;
    state.tab = 'inbox';
    state.openId = '';
    container.innerHTML = '<div id="wl-root"></div>';
    show();
    if (!state.demo) load().catch(error => { state.error = error.message; show(); });
  }
  function homeCard() {
    return '<a class="pb-direct-card" id="wl-home-card" href="' + WORK_URL + '"><span class="pb-home-icon" aria-hidden="true">✉</span><div><p class="market-eyebrow">ОПТОВЫЕ ОБРАЩЕНИЯ</p><h3>Входящие оптовые заявки</h3><p>Рабочий список открывается после входа.</p></div><span class="pb-home-button">Открыть ↗</span></a>';
  }
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(OLD_KEY); } catch (error) {}
  window.WholesaleLeads = {
    mount, homeCard,
    core: {normalize, leadFromFluentForm, applyIncoming, shouldNotify, sourceLabel, channelLabel, demoLeads, filtered, pageOf, fresh, classifyAll, setReview, reportOf, topical, CHANNELS, SOURCES, STAGES, REVIEWS}
  };
})();
