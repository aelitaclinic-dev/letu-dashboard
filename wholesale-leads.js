/* Incoming wholesale inquiries. Site form 3 is idempotent by submission id. Manual cards stay in this browser. */
(function () {
  'use strict';
  const KEY = 'ma-distribution-wholesale-leads-v1';
  const FORM_URL = 'https://maat-impera.ru/wp-json/maat/v1/wholesale-leads';
  const SOURCES = {site: 'Сайт', messenger: 'Мессенджер', social: 'Соцсеть', referral: 'Рекомендация'};
  const CHANNELS = {form: 'Форма прайса', telegram: 'Telegram', max: 'MAX', vk: 'ВКонтакте', phone: 'Телефон', email: 'Почта'};
  const MANUAL_SOURCES = ['messenger', 'social', 'referral'];
  const state = {
    db: null, editor: null, message: '', error: '', storageError: '',
    formStatus: 'pending',
    filters: {source: 'all', reply: 'all'}
  };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const uid = () => window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : 'wl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
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
        timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
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
  function channelsFor(source) {
    if (source === 'social') return ['vk'];
    if (source === 'messenger') return ['telegram', 'max', 'phone', 'email'];
    if (source === 'referral') return ['telegram', 'max', 'vk', 'phone', 'email'];
    return ['form'];
  }
  function contactOf(lead) {
    return [lead.name, lead.phone, lead.email].filter(Boolean).join(' · ');
  }
  function normalize(draft) {
    const lead = {
      id: text(String(draft.id || ''), 80),
      externalId: text(String(draft.externalId || ''), 120),
      receivedAt: parseReceived(draft.receivedAt),
      name: text(String(draft.name || ''), 240),
      phone: text(String(draft.phone || ''), 80),
      email: text(String(draft.email || ''), 240),
      request: text(String(draft.request || ''), 500),
      source: draft.source,
      channel: draft.channel,
      referrer: text(String(draft.referrer || ''), 240),
      stage: draft.stage || 'new',
      firstReplyAt: draft.firstReplyAt ? parseReceived(draft.firstReplyAt) : null
    };
    if (!lead.id) fail('Неверный идентификатор заявки.');
    if (!SOURCES[lead.source]) fail('Укажите источник заявки.');
    if (!CHANNELS[lead.channel]) fail('Укажите канал связи.');
    if (lead.stage !== 'new') fail('Новая заявка открывается со стадией «Новая».');
    if (!lead.request) fail('Укажите краткий запрос.');
    if (!lead.name && !lead.phone && !lead.email) fail('Укажите контакт: имя или телефон.');
    if (lead.source === 'referral' && !lead.referrer) fail('Укажите, кто рекомендовал.');
    if (lead.source !== 'referral') lead.referrer = '';
    if (lead.source === 'site' && lead.channel !== 'form') fail('Заявка с сайта приходит из формы прайса.');
    if (lead.source === 'social' && lead.channel !== 'vk') fail('Для соцсети укажите канал ВКонтакте.');
    if (lead.source === 'messenger' && channelsFor('messenger').indexOf(lead.channel) < 0) fail('Для мессенджера укажите Telegram, MAX, телефон или почту.');
    if (lead.source === 'referral' && channelsFor('referral').indexOf(lead.channel) < 0) fail('Укажите канал, через который написал клиент.');
    if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) fail('Проверьте почту.');
    return lead;
  }
  function validate(db) {
    if (!db || db.schemaVersion !== 1 || !Array.isArray(db.leads) || db.leads.length > 10000) fail('Это не список входящих оптовых заявок.');
    const ids = new Set();
    const external = new Set();
    db.leads.forEach(lead => {
      normalize(lead);
      if (ids.has(lead.id)) fail('Повторяется запись заявки.');
      ids.add(lead.id);
      if (lead.externalId) {
        if (external.has(lead.externalId)) fail('Такая отправка уже есть. Дубль не сохранён.');
        external.add(lead.externalId);
      }
    });
    return db;
  }
  function empty() { return {schemaVersion: 1, leads: [], updatedAt: null}; }
  function leadFromFluentForm(payload) {
    if (!payload || typeof payload !== 'object') fail('Пустая отправка формы.');
    const formId = String(payload.form_id != null ? payload.form_id : (payload.formId != null ? payload.formId : ''));
    if (formId !== '3') fail('Это не форма прайса № 3.');
    const submissionId = String(payload.submission_id != null ? payload.submission_id : (payload.id != null ? payload.id : '')).trim();
    if (!submissionId || submissionId.length > 40 || !/^[A-Za-z0-9_-]+$/.test(submissionId)) fail('У отправки нет номера.');
    const response = payload.response && typeof payload.response === 'object' ? payload.response : {};
    const name = text(String(response.input_text_1 || response.name || ''), 240);
    const phone = text(String(response.input_text || response.phone || ''), 80);
    const email = text(String(response.email || ''), 240);
    const company = text(String(response.input_text_2 || response.company || ''), 240);
    const request = company ? text('Прайс для ' + company, 500) : 'Запрос оптового прайса';
    return normalize({
      id: 'ff3-' + submissionId,
      externalId: 'fluentform:3:' + submissionId,
      receivedAt: payload.created_at || payload.receivedAt,
      name, phone, email, request,
      source: 'site', channel: 'form', referrer: '', stage: 'new', firstReplyAt: null
    });
  }
  function leadFromDraft(draft) {
    const receivedAt = typeof draft.receivedLocal === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.receivedLocal)
      ? draft.receivedLocal + ':00+03:00'
      : draft.receivedAt;
    return normalize({
      id: draft.id,
      externalId: draft.externalId || '',
      receivedAt,
      name: draft.name,
      phone: draft.phone,
      email: draft.email,
      request: draft.request,
      source: draft.source,
      channel: draft.channel,
      referrer: draft.source === 'referral' ? draft.referrer : '',
      stage: 'new',
      firstReplyAt: null
    });
  }
  function blankDraft() {
    return {
      id: uid(), name: '', phone: '', email: '', request: '',
      source: 'messenger', channel: 'telegram', referrer: '',
      receivedLocal: moscowLocal(new Date())
    };
  }
  function visible(leads) {
    return leads.filter(lead => {
      if (state.filters.source !== 'all' && lead.source !== state.filters.source) return false;
      if (state.filters.reply === 'waiting' && lead.firstReplyAt) return false;
      if (state.filters.reply === 'answered' && !lead.firstReplyAt) return false;
      return true;
    }).slice().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || contactOf(a).localeCompare(contactOf(b), 'ru'));
  }
  function cardHtml(lead) {
    const reply = lead.firstReplyAt
      ? '<span class="wl-answered">Ответ отправлен ' + esc(stamp(lead.firstReplyAt)) + '</span>'
      : '<span class="wl-unanswered">Ответа нет</span> <button type="button" class="pb-outline" data-reply="' + esc(lead.id) + '">Ответ отправлен</button>';
    const referrer = lead.source === 'referral'
      ? '<span>Кто рекомендовал <b>' + esc(lead.referrer) + '</b></span>'
      : '';
    return '<article class="wl-card" id="lead-' + esc(lead.id) + '" data-source="' + esc(lead.source) + '" data-stage="' + esc(lead.stage) + '">'
      + '<div class="wl-top"><div><p class="market-eyebrow">' + esc(SOURCES[lead.source]) + '</p><h3>' + esc(contactOf(lead)) + '</h3></div>'
      + '<span class="wl-stage">Новая</span></div>'
      + '<div class="wl-meta"><span>Дата обращения <b>' + esc(stamp(lead.receivedAt)) + '</b></span>'
      + '<span>Канал связи <b>' + esc(CHANNELS[lead.channel]) + '</b></span>'
      + referrer
      + '<span>Стадия <b>Новая</b></span></div>'
      + '<p class="wl-request">Запрос: ' + esc(lead.request) + '</p>'
      + '<div class="wl-reply">' + reply + '</div></article>';
  }
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? validate(JSON.parse(raw)) : empty();
    } catch (error) {
      state.storageError = 'Не удалось прочитать сохранённые заявки. Данные не перезаписаны. ' + error.message;
      return empty();
    }
  }
  function save(db) {
    validate(db);
    db.updatedAt = new Date().toISOString();
    try {
      const current = localStorage.getItem(KEY);
      if (current && JSON.parse(current).updatedAt !== state.db.updatedAt) fail('Записи изменились в другой вкладке. Обновите страницу перед повторным вводом.');
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (error) {
      if (String(error.message).includes('другой вкладке')) throw error;
      fail('Браузер не смог сохранить заявку. Освободите место или разрешите хранение данных.');
    }
    state.db = db;
    state.storageError = '';
    state.error = '';
  }
  function insert(db, lead) {
    if (lead.externalId && db.leads.some(item => item.externalId === lead.externalId)) return false;
    if (db.leads.some(item => item.id === lead.id)) return false;
    db.leads.push(lead);
    return true;
  }
  function ingestFluentForm(payload) {
    const lead = leadFromFluentForm(payload);
    const db = structuredClone(state.db || empty());
    const created = insert(db, lead);
    if (created) save(db);
    if (created && pageRoot() && !state.editor) show();
    const stored = state.db.leads.find(item => item.externalId === lead.externalId) || lead;
    return {created, lead: stored};
  }
  function absorb(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.leads)) return false;
    if (!state.db) state.db = read();
    if (state.storageError) return false;
    const db = structuredClone(state.db);
    let changed = false;
    data.leads.forEach(item => {
      const lead = normalize(item);
      if (insert(db, lead)) changed = true;
    });
    if (!changed) return false;
    save(db);
    paintHome();
    if (pageRoot() && !state.editor) show();
    return true;
  }
  function paintHome() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const current = document.getElementById('wl-home-card');
    if (!current) return;
    const holder = document.createElement('div');
    holder.innerHTML = homeCard();
    current.replaceWith(holder.firstElementChild);
  }
  function pageRoot() {
    if (typeof document === 'undefined' || !document.getElementById) return null;
    return document.getElementById('wl-root');
  }
  function field(label, name, value, extra) {
    return '<label>' + esc(label) + '<input name="' + name + '" value="' + esc(value || '') + '" ' + (extra || '') + '></label>';
  }
  function editorHtml(draft) {
    const channels = channelsFor(draft.source);
    const channel = channels.indexOf(draft.channel) >= 0 ? draft.channel : channels[0];
    draft.channel = channel;
    const referrer = draft.source === 'referral'
      ? field('Кто рекомендовал', 'referrer', draft.referrer, 'required maxlength="240" placeholder="Катя"')
      : '';
    return '<section class="pb-editor" id="wl-editor" tabindex="-1"><div class="pb-panel-title"><div><p class="market-eyebrow">НОВАЯ ЗАЯВКА</p><h3>Добавить заявку</h3></div><button type="button" class="pb-quiet" data-action="close-editor">Закрыть ✕</button></div>'
      + '<form id="wl-form"><div class="pb-form-grid">'
      + '<label>Дата обращения<input name="received" type="datetime-local" required value="' + esc(draft.receivedLocal) + '"></label>'
      + field('Имя', 'name', draft.name, 'maxlength="240" placeholder="Имя клиента"')
      + field('Телефон', 'phone', draft.phone, 'maxlength="80" placeholder="+7 000 000-00-00"')
      + field('Почта', 'email', draft.email, 'maxlength="240" placeholder="Необязательно"')
      + '<label>Источник<select name="source">' + MANUAL_SOURCES.map(key => '<option value="' + key + '"' + (key === draft.source ? ' selected' : '') + '>' + esc(SOURCES[key]) + '</option>').join('') + '</select></label>'
      + '<label>Канал связи<select name="channel">' + channels.map(key => '<option value="' + key + '"' + (key === channel ? ' selected' : '') + '>' + esc(CHANNELS[key]) + '</option>').join('') + '</select></label>'
      + referrer
      + '</div><label class="pb-note-field">Запрос<textarea name="request" required maxlength="500" placeholder="Что нужно клиенту">' + esc(draft.request || '') + '</textarea></label>'
      + '<p class="pb-help">Заявка попадёт в этот же список со стадией «Новая». Для рекомендации укажите, кто посоветовал, и канал, куда клиент написал.</p>'
      + '<p id="wl-form-error" class="pb-error" role="alert"></p><div class="pb-editor-actions"><span>Ручная заявка останется в этом браузере.</span><button class="pb-primary" type="submit">Сохранить заявку</button></div></form></section>';
  }
  function formStatusText() {
    if (state.formStatus === 'connected') return 'Форма прайса № 3 подключена. Новая отправка создаёт одну карточку со стадией «Новая» и источником «Сайт». Повтор той же отправки вторую карточку не создаёт.';
    if (state.formStatus === 'unavailable') return 'Форма прайса на сайте пока не отдаёт заявки в этот список. Нужен администратор WordPress на maat-impera.ru, чтобы включить плагин MAAT Wholesale Leads. Ручной ввод уже работает. Повтор одной и той же отправки не создаёт вторую карточку.';
    return 'Проверяю подключение формы прайса.';
  }
  function show() {
    const container = document.getElementById('screen');
    const root = document.getElementById('wl-root');
    if (!container && !root) return;
    const leads = visible(state.db.leads);
    const html = '<div class="pb-page wl-page" id="wl-root"><div class="pb-heading"><div><a class="do-back" href="#purchases">← К закупкам</a><p class="market-eyebrow">MA DISTRIBUTION / ОПТ</p><h2>Входящие оптовые заявки</h2><p>Сайт, мессенджеры, соцсети и рекомендации в одном списке.</p></div><button class="pb-primary" type="button" data-action="new-lead">＋ Добавить заявку</button></div>'
      + '<p class="pb-message" id="wl-form-status">' + esc(formStatusText()) + '</p>'
      + (state.storageError ? '<p class="pb-error" role="alert">' + esc(state.storageError) + '</p>' : '')
      + '<p class="pb-message" role="status">' + esc(state.message) + '</p>'
      + (state.error ? '<p class="pb-error" role="alert">' + esc(state.error) + '</p>' : '')
      + '<form class="pb-filters do-filters" id="wl-filters"><label>Источник<select name="source"><option value="all"' + (state.filters.source === 'all' ? ' selected' : '') + '>Все источники</option>'
      + Object.keys(SOURCES).map(key => '<option value="' + key + '"' + (state.filters.source === key ? ' selected' : '') + '>' + esc(SOURCES[key]) + '</option>').join('')
      + '</select></label><label>Первый ответ<select name="reply"><option value="all"' + (state.filters.reply === 'all' ? ' selected' : '') + '>Все</option><option value="waiting"' + (state.filters.reply === 'waiting' ? ' selected' : '') + '>Без ответа</option><option value="answered"' + (state.filters.reply === 'answered' ? ' selected' : '') + '>Ответ отправлен</option></select></label></form>'
      + (state.editor ? editorHtml(state.editor) : '')
      + (leads.length ? leads.map(cardHtml).join('') : '<p class="pb-help">Заявок по этому фильтру нет.</p>')
      + '</div>';
    if (root && root.parentElement) root.parentElement.innerHTML = html;
    else container.innerHTML = html;
    bind(document.getElementById('wl-root'));
  }
  function collect(form) {
    const draft = state.editor;
    draft.receivedLocal = form.elements.received.value;
    draft.name = form.elements.name.value;
    draft.phone = form.elements.phone.value;
    draft.email = form.elements.email.value;
    draft.request = form.elements.request.value;
    draft.source = form.elements.source.value;
    draft.channel = form.elements.channel.value;
    draft.referrer = form.elements.referrer ? form.elements.referrer.value : '';
    return draft;
  }
  function commit(lead) {
    const db = structuredClone(state.db);
    if (!insert(db, lead)) fail('Такая заявка уже есть. Дубль не сохранён.');
    save(db);
    state.editor = null;
    state.message = 'Заявка добавлена в список.';
    show();
    const card = document.getElementById('lead-' + lead.id);
    if (card) card.scrollIntoView({block: 'nearest'});
  }
  function markReply(id) {
    const db = structuredClone(state.db);
    const lead = db.leads.find(item => item.id === id);
    if (!lead) fail('Заявка не найдена.');
    if (lead.firstReplyAt) return;
    lead.firstReplyAt = new Date().toISOString();
    save(db);
    state.message = 'Время ответа записано.';
    show();
  }
  function bind(root) {
    const filters = root.querySelector('#wl-filters');
    filters.onchange = () => {
      const data = new FormData(filters);
      state.filters = {source: String(data.get('source') || 'all'), reply: String(data.get('reply') || 'all')};
      const form = document.getElementById('wl-form');
      if (form) collect(form);
      show();
    };
    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.type === 'submit') return;
      try {
        if (button.dataset.action === 'new-lead') {
          if (state.editor) fail('Сохраните или закройте открытую заявку.');
          state.editor = blankDraft();
          state.message = '';
          state.error = '';
          show();
          document.getElementById('wl-editor').focus();
        }
        if (button.dataset.action === 'close-editor') {
          state.editor = null;
          show();
        }
        if (button.dataset.reply) markReply(button.dataset.reply);
      } catch (error) {
        state.error = error.message;
        show();
      }
    });
    const form = root.querySelector('#wl-form');
    if (!form) return;
    form.addEventListener('change', event => {
      collect(form);
      if (event.target.name === 'source') show();
    });
    form.onsubmit = event => {
      event.preventDefault();
      try {
        if (state.storageError) fail(state.storageError);
        commit(leadFromDraft(collect(form)));
      } catch (error) {
        const slot = root.querySelector('#wl-form-error');
        if (slot) slot.textContent = error.message;
      }
    };
  }
  function homeCard() {
    const count = state.db ? String(state.db.leads.length) : '…';
    return '<a class="pb-direct-card" id="wl-home-card" href="#leads" aria-label="Входящие оптовые заявки, карточек ' + esc(count) + '"><span class="pb-home-icon" aria-hidden="true">✉</span><div><p class="market-eyebrow">ОПТОВЫЕ ОБРАЩЕНИЯ</p><h3>Входящие оптовые заявки</h3><p>Сайт, мессенджеры и рекомендации в одном списке.</p></div><div class="pb-direct-metrics"><div><span>Заявок</span><strong>' + esc(count) + '</strong></div></div><span class="pb-home-button">Открыть ↗</span></a>';
  }
  function mount(container) {
    if (!state.db) state.db = read();
    container.innerHTML = '<div id="wl-root"></div>';
    show();
  }
  window.WholesaleLeads = {
    mount, homeCard,
    core: {validate, normalize, empty, leadFromFluentForm, leadFromDraft, ingestFluentForm, absorb, cardHtml, contactOf, SOURCES, CHANNELS}
  };
  state.db = read();
  function take(url) {
    return fetch(url, {cache: 'no-store'}).then(response => response.ok ? response.json() : null);
  }
  take('wholesale-leads.json').then(data => {
    try { absorb(data); } catch (error) { state.error = 'Общий список заявок не подключён. ' + error.message; }
  }).catch(() => {}).then(() => take(FORM_URL).then(data => {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.leads)) {
      state.formStatus = 'unavailable';
    } else {
      state.formStatus = 'connected';
      try { absorb(data); } catch (error) { state.error = 'Заявки формы не приняты. ' + error.message; }
    }
    if (pageRoot() && !state.editor) show();
  }).catch(() => {
    state.formStatus = 'unavailable';
    if (pageRoot() && !state.editor) show();
  }));
})();
