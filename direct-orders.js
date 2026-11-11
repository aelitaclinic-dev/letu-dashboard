/* Direct orders from clients, in person or by correspondence. No marketplace credentials. */
(function () {
  'use strict';
  const KEY = 'ma-distribution-direct-orders-v1';
  const CLARIFY = 'Состав заказа требует уточнения';
  const PROFIT_GAP = 'Расчёт прибыли требует уточнения';
  const MAX = Number.MAX_SAFE_INTEGER;
  const payments = {unknown: 'Не указано', unpaid: 'Не оплачен', partial: 'Частично оплачен', paid: 'Оплачен'};
  const fulfillment = {unknown: 'Не указано', new: 'Не начато', progress: 'В работе', done: 'Выполнен', cancelled: 'Отменён'};
  const state = {
    db: null, editor: null, openedId: null, message: '', error: '', storageError: '',
    remoteSettled: false, remoteError: false,
    filters: {from: '', to: '', client: '', payment: 'all', fulfillment: 'all'}
  };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const norm = v => String(v || '').trim().toLocaleLowerCase('ru');
  const day = v => v ? esc(v.split('-').reverse().join('.')) : '';
  const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Moscow'}).format(new Date());
  const uid = () => window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : 'do-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  function fail(text) { throw new Error(text); }
  function safe(n) { if (!Number.isSafeInteger(n) || Math.abs(n) > MAX) fail('Сумма или количество слишком велики.'); return n; }
  function money(kop) {
    if (kop == null) return 'Не указано';
    const sign = kop < 0 ? '−' : '';
    const abs = Math.abs(kop);
    const whole = Math.floor(abs / 100);
    const frac = abs % 100;
    const text = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return sign + (frac ? text + ',' + String(frac).padStart(2, '0') : text) + ' ₽';
  }
  function rubInput(kop) {
    if (kop == null) return '';
    const abs = Math.abs(kop);
    const text = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const frac = abs % 100;
    return (kop < 0 ? '-' : '') + (frac ? text + ',' + String(frac).padStart(2, '0') : text);
  }
  function missing() { return '<span class="do-missing">Не указано</span>'; }
  function shown(value) { return value ? esc(value) : missing(); }
  function text(v, max) {
    if (typeof v !== 'string' || v.length > max) fail('Текст слишком длинный или имеет неверный формат.');
    return v.trim();
  }
  function optionalDate(v) {
    if (v == null || v === '') return '';
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) !== v) fail('Проверьте дату заказа.');
    return v;
  }
  function moneyInput(value, label, allowEmpty) {
    const raw = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
    if (!raw) { if (allowEmpty) return null; fail('Заполните поле «' + label + '».'); }
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) fail('Проверьте поле «' + label + '».');
    const parts = raw.split('.');
    return safe(Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0')));
  }
  function integer(value, label) {
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 10000000) fail('«' + label + '» — целое число больше нуля.');
    return Number(value);
  }
  function empty() { return {schemaVersion: 1, orders: [], updatedAt: null}; }
  function catalog() {
    return ((window.DASHBOARD || {}).unitEconomics && window.DASHBOARD.unitEconomics.groups || []).flatMap(g => (g.items || []).map(item => ({
      sku: item.article, name: item.name + (g.volume ? ' · ' + g.volume : ''), brand: g.brand || ''
    })));
  }
  function identity(order) {
    return [norm(order.client), order.totalKop, norm(order.channel), order.date || '', norm(order.number)].join('|');
  }
  function validateOrder(order) {
    if (!order || typeof order.id !== 'string' || !order.id.trim() || order.id.length > 80) fail('Неверный идентификатор заказа.');
    text(order.number || '', 80);
    optionalDate(order.date);
    if (!text(order.client || '', 240)) fail('Укажите имя клиента.');
    if (!text(order.channel || '', 80)) fail('Укажите канал заказа.');
    text(order.delivery || '', 2000);
    text(order.comment || '', 2000);
    if (!Number.isSafeInteger(order.totalKop) || order.totalKop < 0) fail('Укажите общую сумму заказа.');
    safe(order.totalKop);
    if (!payments[order.paymentStatus] || !fulfillment[order.fulfillmentStatus]) fail('Проверьте статус оплаты или выполнения.');
    if (order.paidKop != null && (!Number.isSafeInteger(order.paidKop) || order.paidKop < 0)) fail('Проверьте фактически оплаченную сумму.');
    if (order.paymentStatus === 'unknown' && order.paidKop != null) fail('Сумма оплаты без статуса не сохраняется. Выберите статус или очистите сумму.');
    if (order.paymentStatus === 'unpaid' && order.paidKop != null && order.paidKop !== 0) fail('Для статуса «Не оплачен» оплаченная сумма пустая или равна нулю.');
    if (order.paymentStatus === 'partial' && (order.paidKop == null || order.paidKop <= 0 || order.paidKop >= order.totalKop)) fail('Для частичной оплаты укажите сумму больше нуля и меньше суммы заказа.');
    if (order.paymentStatus === 'paid' && (order.paidKop == null || order.paidKop < order.totalKop)) fail('Для статуса «Оплачен» укажите фактически полученную сумму не меньше суммы заказа.');
    if (order.sourceRevision != null && (!Number.isSafeInteger(order.sourceRevision) || order.sourceRevision < 0)) fail('Неверная версия общего заказа.');
    if (order.compositionStatus === 'needs-clarification') {
      if (!Array.isArray(order.lines) || order.lines.length) fail('Пока состав не уточнён, строки товаров не сохраняются.');
      if (order.compositionNote !== CLARIFY) fail('Отметка о составе заказа повреждена.');
    } else if (order.compositionStatus === 'known' || order.compositionStatus === 'mismatch') {
      const sum = lineTotal(order.lines);
      if (order.compositionStatus === 'known' && sum !== order.totalKop) fail('Общая сумма заказа не совпадает с суммой цен продажи.');
      if (order.compositionStatus === 'mismatch' && sum === order.totalKop) fail('Сумма строк совпадает с заказом. Отметка о расхождении не нужна.');
      if (order.compositionStatus === 'mismatch' && !text(order.compositionNote || '', 2000)) fail('Опишите, почему сумма строк не совпадает с суммой заказа.');
    } else fail('Укажите, известен ли состав заказа.');
    return order;
  }
  function validate(db) {
    if (!db || db.schemaVersion !== 1 || !Array.isArray(db.orders) || db.orders.length > 10000) fail('Это не журнал прямых заказов MA Distribution.');
    const ids = new Set();
    const seen = new Set();
    db.orders.forEach(order => {
      validateOrder(order);
      if (ids.has(order.id)) fail('Повторяется запись заказа.');
      ids.add(order.id);
      const key = identity(order);
      if (seen.has(key)) fail('Такой заказ уже есть. Дубль не сохранён.');
      seen.add(key);
    });
    return db;
  }
  function knownPaid(order) {
    if (Number.isSafeInteger(order.paidKop) && order.paidKop >= 0 && order.paymentStatus !== 'unknown') return order.paidKop;
    if (order.paymentStatus === 'unpaid') return 0;
    return null;
  }
  function paymentFacts(order) {
    const paid = knownPaid(order);
    if (paid == null || !['unpaid', 'partial', 'paid'].includes(order.paymentStatus) || !Number.isSafeInteger(order.totalKop)) return {known: false, paidKop: null, debtKop: null};
    if (order.paymentStatus === 'partial' && (paid <= 0 || paid >= order.totalKop)) return {known: false, paidKop: null, debtKop: null};
    if (order.paymentStatus === 'paid' && paid < order.totalKop) return {known: false, paidKop: null, debtKop: null};
    return {known: true, paidKop: paid, debtKop: Math.max(0, order.totalKop - paid)};
  }
  function totals(orders) {
    const count = orders.length;
    const withTotal = orders.filter(order => Number.isSafeInteger(order.totalKop));
    const sumKop = count && withTotal.length === count ? withTotal.reduce((sum, order) => safe(sum + order.totalKop), 0) : (count ? null : 0);
    const paidValues = orders.map(knownPaid).filter(value => value != null);
    const debts = orders.map(paymentFacts).filter(row => row.known);
    return {
      count,
      sumKop,
      paidKop: paidValues.length ? paidValues.reduce((sum, value) => safe(sum + value), 0) : (count ? null : 0),
      debtKop: debts.length ? debts.reduce((sum, row) => safe(sum + row.debtKop), 0) : (count ? null : 0),
      paidCount: paidValues.length,
      debtCount: debts.length,
      sumCount: withTotal.length
    };
  }
  function lineTotal(lines) {
    if (!Array.isArray(lines) || !lines.length || lines.length > 200) fail('Добавьте товары заказа.');
    return lines.reduce((sum, line) => {
      if (!text(line.sku || '', 240) || !text(line.name || '', 240)) fail('Укажите артикул и название каждого товара.');
      text(line.brand || '', 240);
      text(line.unit || '', 40);
      text(line.volume || '', 40);
      const qty = integer(line.qty, 'Количество');
      if (!Number.isSafeInteger(line.priceMinor) || line.priceMinor < 0) fail('Проверьте цену продажи.');
      return safe(sum + safe(qty * line.priceMinor));
    }, 0);
  }
  function channelPrep(line) {
    const purchases = window.PurchaseBook && window.PurchaseBook.core;
    const empty = {unitKop: 0, packingKop: 0, parts: []};
    if (!purchases || typeof purchases.preparationFor !== 'function') return empty;
    const model = purchases.preparationFor({sku: line.sku, brand: line.brand || 'SINKO STYLING', gift: false});
    if (!model) return empty;
    let unitKop = 0;
    let packingKop = 0;
    const parts = [];
    (model.parts || []).forEach(part => {
      if (part.label === 'Коробочка' || part.label === 'Этикетка коробки') {
        parts.push({label: part.label, amountKop: 0, excluded: true, reason: 'Одна общая коробка'});
        return;
      }
      if (part.label === 'Упаковщик' || part.label === 'Плёнка') {
        packingKop = safe(packingKop + (part.excluded ? 0 : part.amountKop));
        parts.push({label: part.label, amountKop: 0, excluded: true, reason: 'Один раз на заказ'});
        return;
      }
      if (part.excluded) {
        parts.push(part);
        return;
      }
      unitKop = safe(unitKop + part.amountKop);
      parts.push(part);
    });
    return {unitKop, packingKop, parts, missing: model.missing || []};
  }
  function lineEconomy(line) {
    if (!Number.isSafeInteger(line.priceMinor) || line.priceMinor < 0 || !Number.isSafeInteger(line.qty) || line.qty < 1) {
      return {state: 'needs-clarification', reason: PROFIT_GAP};
    }
    const purchases = window.PurchaseBook && window.PurchaseBook.core;
    const db = purchases && typeof purchases.database === 'function' ? purchases.database() : null;
    const landed = purchases && typeof purchases.skuLanded === 'function' ? purchases.skuLanded(line.sku, db) : null;
    if (landed && Number.isSafeInteger(landed.landedUnitKop)) {
      const prep = channelPrep(line);
      const unitCostKop = safe(landed.landedUnitKop + prep.unitKop);
      const unitProfitKop = safe(line.priceMinor - unitCostKop);
      return {
        state: 'known',
        source: 'purchase',
        basis: landed.basis,
        moscowFreight: landed.moscowFreight,
        unitGoodsKop: landed.goodsUnitKop,
        unitFreightKop: landed.freightUnitKop,
        unitPrepKop: prep.unitKop,
        packingKop: prep.packingKop,
        unitCostKop, unitProfitKop,
        costKop: safe(unitCostKop * line.qty),
        profitKop: safe(unitProfitKop * line.qty),
        goodsKop: safe(landed.goodsUnitKop * line.qty),
        freightKop: safe(landed.freightUnitKop * line.qty)
      };
    }
    const api = window.UnitCost;
    if (!api) return {state: 'needs-clarification', reason: PROFIT_GAP};
    const found = api.find(line.sku);
    if (!found) return {state: 'needs-clarification', reason: 'Артикул не найден в закупках и в справочнике. ' + PROFIT_GAP + '.'};
    if (found.ambiguous) return {state: 'needs-clarification', reason: 'В справочнике несколько карточек с этим артикулом. ' + PROFIT_GAP + '.'};
    const costRub = api.accountedUnitCost(found);
    if (costRub == null || !Number.isFinite(Number(costRub))) return {state: 'needs-clarification', reason: PROFIT_GAP + '. Себестоимость карточки заполнена не полностью.'};
    const unitCostKop = Math.round(Number(costRub) * 100);
    if (!Number.isSafeInteger(unitCostKop) || unitCostKop < 0) return {state: 'needs-clarification', reason: PROFIT_GAP};
    const unitProfitKop = safe(line.priceMinor - unitCostKop);
    return {
      state: 'known', source: 'card', moscowFreight: 'unknown',
      unitCostKop, unitProfitKop,
      costKop: safe(unitCostKop * line.qty), profitKop: safe(unitProfitKop * line.qty)
    };
  }
  function orderProfit(order) {
    if (!order || !order.lines || !order.lines.length || order.compositionStatus === 'needs-clarification') {
      return {state: 'needs-clarification', reason: PROFIT_GAP, lines: []};
    }
    const lines = order.lines.map(lineEconomy);
    if (lines.some(line => line.state !== 'known')) return {state: 'needs-clarification', reason: PROFIT_GAP, lines};
    const packingKop = lines.reduce((max, line) => Math.max(max, line.packingKop || 0), 0);
    const saleKop = order.lines.reduce((sum, line) => safe(sum + safe(line.qty * line.priceMinor)), 0);
    const costKop = safe(lines.reduce((sum, line) => safe(sum + line.costKop), 0) + packingKop);
    const freightGap = lines.some(line => line.moscowFreight === 'not-in-batch');
    return {
      state: 'known',
      reason: freightGap ? 'Доставка до Москвы по части позиций в принятых партиях ещё не стоит. Показанная прибыль по ним — верхняя оценка.' : '',
      freightGap,
      packingKop,
      taxKop: 0,
      outboundKop: 0,
      boxKop: 0,
      saleKop,
      costKop,
      profitKop: safe(saleKop - costKop),
      goodsKop: lines.reduce((sum, line) => safe(sum + (line.goodsKop || 0)), 0),
      freightKop: lines.reduce((sum, line) => safe(sum + (line.freightKop || 0)), 0),
      lines
    };
  }
  function applyFilters(orders, filters) {
    const from = filters.from || '';
    const to = filters.to || '';
    const period = Boolean(from || to);
    const visible = [];
    let undated = 0;
    orders.forEach(order => {
      if (filters.client && norm(order.client) !== norm(filters.client)) return;
      if (filters.payment && filters.payment !== 'all' && order.paymentStatus !== filters.payment) return;
      if (filters.fulfillment && filters.fulfillment !== 'all' && order.fulfillmentStatus !== filters.fulfillment) return;
      if (period && !order.date) { undated += 1; return; }
      if (from && order.date < from) return;
      if (to && order.date > to) return;
      visible.push(order);
    });
    visible.sort((a, b) => {
      if (!a.date && !b.date) return a.client.localeCompare(b.client, 'ru');
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date) || a.client.localeCompare(b.client, 'ru');
    });
    return {orders: visible, undated};
  }
  function mergeShared(current, incoming) {
    const source = structuredClone(incoming);
    const base = current && current._sharedBase;
    if (!current) return {record: {...source, _sharedBase: structuredClone(source)}, changed: true, conflicts: 0};
    if (!base || (source.sourceRevision || 0) <= (base.sourceRevision || 0)) return {record: current, changed: false, conflicts: 0};
    const next = structuredClone(current);
    let conflicts = 0;
    for (const field of new Set([...Object.keys(base), ...Object.keys(source)])) {
      if (field === '_sharedBase' || field === 'sourceRevision') continue;
      const local = JSON.stringify(current[field]);
      const previous = JSON.stringify(base[field]);
      const remote = JSON.stringify(source[field]);
      if (local === previous) { if (field in source) next[field] = source[field]; else delete next[field]; }
      else if (remote !== previous && remote !== local) conflicts += 1;
    }
    next.sourceRevision = source.sourceRevision;
    next._sharedBase = structuredClone(source);
    return {record: next, changed: true, conflicts};
  }
  function appendOrders(db, incomingOrders) {
    const next = structuredClone(db);
    let changed = 0;
    let skipped = 0;
    let conflicts = 0;
    incomingOrders.forEach(order => {
      validateOrder(order);
      const index = next.orders.findIndex(item => item.id === order.id);
      if (index < 0 && next.orders.some(item => identity(item) === identity(order))) { skipped += 1; return; }
      const merged = mergeShared(index < 0 ? null : next.orders[index], order);
      if (!merged.changed) return;
      if (index < 0) next.orders.push(merged.record);
      else next.orders[index] = merged.record;
      changed += 1;
      conflicts += merged.conflicts;
    });
    if (changed) validate(next);
    return {db: next, changed, skipped, conflicts};
  }
  function normalOrder(draft) {
    const order = {
      id: draft.id,
      sourceRevision: draft.sourceRevision || 0,
      number: text(String(draft.number || ''), 80),
      date: optionalDate(draft.date),
      client: text(String(draft.client || ''), 240),
      channel: text(String(draft.channel || ''), 80),
      delivery: text(String(draft.delivery || ''), 2000),
      comment: text(String(draft.comment || ''), 2000),
      paymentStatus: draft.paymentStatus,
      fulfillmentStatus: draft.fulfillmentStatus,
      paidKop: moneyInput(draft.paidText, 'Фактически оплачено', true),
      totalKop: moneyInput(draft.totalText, 'Общая сумма заказа', false)
    };
    if (!order.client) fail('Укажите имя клиента.');
    if (!order.channel) fail('Укажите канал заказа.');
    if (draft.clarify) {
      order.lines = [];
      order.compositionStatus = 'needs-clarification';
      order.compositionNote = CLARIFY;
    } else {
      order.lines = (draft.lines || []).map(line => {
        const row = {
          sku: text(String(line.sku || ''), 240),
          name: text(String(line.name || ''), 240),
          brand: text(String(line.brand || ''), 240),
          qty: integer(line.qty, 'Количество'),
          priceMinor: moneyInput(line.priceText, 'Цена продажи', false)
        };
        const unit = text(String(line.unit || ''), 40);
        if (unit) row.unit = unit;
        const volume = text(String(line.volume || ''), 40);
        if (volume) row.volume = volume;
        return row;
      });
      const sum = lineTotal(order.lines);
      if (sum === order.totalKop) {
        order.compositionStatus = 'known';
        order.compositionNote = '';
      } else {
        order.compositionStatus = 'mismatch';
        const same = Number(draft.notedLineTotal) === sum && Number(draft.notedOrderTotal) === order.totalKop && draft.compositionNote;
        order.compositionNote = same ? text(String(draft.compositionNote), 2000) : ('Сумма строк ' + money(sum) + ', общая сумма заказа ' + money(order.totalKop) + '. Разница требует уточнения.');
      }
    }
    if (draft._sharedBase) order._sharedBase = draft._sharedBase;
    return validateOrder(order);
  }
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? validate(JSON.parse(raw)) : empty();
    } catch (error) {
      state.storageError = 'Не удалось прочитать сохранённые прямые заказы. Данные не перезаписаны. ' + error.message;
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
      fail('Браузер не смог сохранить запись. Освободите место или разрешите хранение данных.');
    }
    state.db = db;
    state.storageError = '';
    state.error = '';
  }
  function options(values, value) {
    return values.map(([key, label]) => '<option value="' + esc(key) + '"' + (key === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  }
  function field(label, name, value, type, extra) {
    return '<label>' + esc(label) + '<input name="' + name + '" type="' + type + '" value="' + esc(value == null ? '' : value) + '" ' + (extra || '') + '></label>';
  }
  function profitText(result) {
    if (!result || result.state !== 'known') return '<span class="do-missing">' + esc(PROFIT_GAP) + '</span>';
    return '<b>' + money(result.profitKop) + '</b><small>' + (result.freightGap
      ? 'По учтённым статьям, без налога, коробочки и клиентской доставки. Доставка до Москвы по части позиций ещё не в партии — это верхняя оценка.'
      : 'Продажа минус закупка, доставка партии до склада и подготовка этого канала. Налог, коробочка и доставка клиенту не вычитаются.') + '</small>';
  }
  function costCell(economy) {
    if (!economy || economy.state !== 'known') return '<span class="do-missing">' + esc(PROFIT_GAP) + '</span>';
    const freight = economy.moscowFreight === 'not-in-batch'
      ? 'доставка партии только по инвойсу, без Москвы'
      : (economy.moscowFreight === 'included' ? 'с доставкой до Москвы' : '');
    const parts = [];
    if (economy.unitGoodsKop != null) parts.push('товар ' + money(economy.unitGoodsKop));
    if (economy.unitFreightKop != null) parts.push('доставка партии ' + money(economy.unitFreightKop));
    if (economy.unitPrepKop) parts.push('этикетка ' + money(economy.unitPrepKop));
    if (freight) parts.push(freight);
    return '<b>' + money(economy.unitCostKop) + '</b>' + (parts.length ? '<small>' + esc(parts.join(' · ')) + '</small>' : '');
  }
  function profitCell(economy) {
    if (!economy || economy.state !== 'known') return '<span class="do-missing">' + esc(PROFIT_GAP) + '</span>';
    const tone = economy.unitProfitKop < 0 ? ' class="do-loss"' : (economy.unitProfitKop < 40000 ? ' class="do-thin"' : '');
    return '<b' + tone + '>' + money(economy.profitKop) + '</b><small>' + money(economy.unitProfitKop) + ' с единицы</small>';
  }
  function economicsPanel(order, profit) {
    if (profit.state !== 'known') return '';
    const prepKop = safe((profit.costKop || 0) - (profit.goodsKop || 0) - (profit.freightKop || 0));
    const free = order.lines.find(line => line.sku === 'SKUK502');
    const four = order.lines.find(line => line.sku === 'SKUK5022');
    const freeE = free ? lineEconomy(free) : null;
    const fourE = four ? lineEconomy(four) : null;
    const why = (freeE && fourE && freeE.state === 'known' && fourE.state === 'known')
      ? '<p class="do-why"><strong>Почему цена кажется низкой.</strong> FM 4% стоит ' + money(four.priceMinor) + ' против ' + money(free.priceMinor) + ' у FM Free не потому, что его «отдали почти даром»: закупка FM 4% ' + money(fourE.unitGoodsKop) + ' за флакон, FM Free — ' + money(freeE.unitGoodsKop) + '. В рублях FM 4% зарабатывает больше. Тонкая маржа у FM Free и Blue: доставка до Москвы на дорогой артикул даёт ' + money(freeE.unitFreightKop) + ' из ' + money(freeE.unitCostKop) + ' себестоимости. Оптовый прайс мастера далеко ниже витрины Л’Этуаль (2 700–3 399 ₽ за 500 мл ухода).</p>'
      : '';
    return '<div class="do-econ"><div><span>Товар</span><strong>' + money(profit.goodsKop) + '</strong><small>Средняя закупка принятых партий, иначе цена инвойса</small></div><div><span>Доставка партий до склада</span><strong>' + money(profit.freightKop) + '</strong><small>Это не доставка клиенту</small></div><div><span>Подготовка этого заказа</span><strong>' + money(prepKop) + '</strong><small>Этикетка на флакон, упаковщик и плёнка один раз. Коробочка 0 ₽</small></div><div><span>Налог и доставка клиенту</span><strong>0 ₽</strong><small>Оплата на личную карту, доставку оплатил клиент</small></div><div class="do-econ-sum"><span>Прибыль по учтённым статьям</span><strong>' + money(profit.profitKop) + '</strong><small>' + (profit.freightGap ? esc(profit.reason) : 'Все статьи доставки партии учтены') + '</small></div></div>' + why;
  }
  function packingActions(order) {
    const doc = order.packingDocument;
    if (!doc || typeof doc !== 'object') return '';
    const html = typeof doc.html === 'string' ? doc.html.trim() : '';
    const file = typeof doc.docx === 'string' ? doc.docx.trim() : '';
    const pdf = typeof doc.pdf === 'string' ? doc.pdf.trim() : '';
    if ([html, file, pdf].some(value => value.length > 240) || (!html && !file && !pdf)) return '';
    return '<div class="do-print-actions">'
      + (html ? '<a class="pb-primary" href="' + esc(html) + '">Открыть упаковочный лист</a><a class="pb-outline" href="' + esc(html) + '?print=1">Печать</a>' : '')
      + (pdf ? '<a class="pb-outline" href="' + esc(pdf) + '" download>Скачать PDF</a>' : '')
      + (file ? '<a class="pb-outline" href="' + esc(file) + '" download>Скачать Word</a>' : '')
      + '</div>';
  }
  function orderCard(order) {
    const profit = orderProfit(order);
    const paid = knownPaid(order);
    const debt = paymentFacts(order);
    const open = state.openedId === order.id;
    const goods = order.lines && order.lines.length ? lineTotal(order.lines) : null;
    const qtyCount = order.lines && order.lines.length ? order.lines.reduce((sum, line) => safe(sum + line.qty), 0) : 0;
    const lines = order.lines && order.lines.length ? order.lines.map((line, index) => {
      const economy = profit.lines[index] || lineEconomy(line);
      const amount = safe(line.qty * line.priceMinor);
      const volume = line.volume ? ' · ' + line.volume : '';
      return '<tr><td><strong>' + esc(line.name) + '</strong><small>' + esc(line.sku) + (line.brand ? ' · ' + esc(line.brand) : '') + esc(volume) + '</small></td><td>' + esc(line.qty) + (line.unit ? ' ' + esc(line.unit) : '') + '</td><td>' + money(line.priceMinor) + '</td><td>' + money(amount) + '</td><td>' + costCell(economy) + '</td><td>' + profitCell(economy) + '</td></tr>';
    }).join('') : '';
    const foot = lines ? '<tfoot><tr><th>Итого</th><td>' + esc(String(qtyCount)) + '</td><td></td><td>' + money(goods) + '</td><td colspan="2">' + esc((order.lines.length) + ' позиций · ' + qtyCount + ' единиц') + '</td></tr></tfoot>' : '';
    return '<article class="pb-order do-order" id="order-' + esc(order.id) + '"><div class="do-order-top"><div><p class="market-eyebrow">' + esc(order.channel || 'прямой заказ') + '</p><h4>' + esc(order.client) + '</h4><p>Номер: ' + shown(order.number) + ' · Дата: ' + (order.date ? day(order.date) : missing()) + '</p></div><div class="pb-order-total"><small>Сумма заказа</small><strong>' + money(order.totalKop) + '</strong><span>Оплачено: ' + (paid == null ? missing() : money(paid)) + '</span></div></div>' + packingActions(order) + '<div class="do-facts"><span>Оплата <b>' + esc(payments[order.paymentStatus]) + '</b></span><span>Выполнение <b>' + esc(fulfillment[order.fulfillmentStatus]) + '</b></span><span>Доставка <b>' + shown(order.delivery) + '</b></span><span>Задолженность <b>' + (debt.known ? money(debt.debtKop) : missing()) + '</b></span></div>' + (order.compositionStatus === 'needs-clarification' ? '<p class="do-clarify">' + esc(CLARIFY) + '</p>' : '') + (order.compositionStatus === 'mismatch' ? '<p class="do-mismatch">' + esc(order.compositionNote) + '</p><p class="do-line-total"><span>Сумма строк</span><b>' + money(goods) + '</b></p>' : '') + economicsPanel(order, profit) + (lines ? '<div class="pb-table-wrap"><table><thead><tr><th>Товар / артикул</th><th>Количество</th><th>Цена продажи</th><th>Сумма строки</th><th>Себестоимость канала</th><th>Прибыль строки</th></tr></thead><tbody>' + lines + '</tbody>' + foot + '</table></div><p class="pb-help">Себестоимость канала: средняя закупка и доставка партии из журнала закупок плюс этикетка на флакон. Коробочка и этикетка коробки не входят — позиции ушли в одной коробке. Налог 0 ₽: оплата на личную карту. Доставка клиенту 0 ₽: её оплатил клиент. Комиссия площадки не применяется.</p>' : '') + '<p class="do-profit">Прибыль: ' + profitText(profit) + '</p><div class="pb-order-actions"><button type="button" class="pb-outline" data-open="' + esc(order.id) + '" aria-expanded="' + open + '">' + (open ? 'Скрыть заказ' : 'Просмотр') + '</button><button type="button" class="pb-outline" data-edit="' + esc(order.id) + '">Редактировать</button></div>' + (open ? '<div class="do-detail"><dl><div><dt>Номер заказа</dt><dd>' + shown(order.number) + '</dd></div><div><dt>Дата заказа</dt><dd>' + (order.date ? day(order.date) : missing()) + '</dd></div><div><dt>Имя клиента</dt><dd>' + esc(order.client) + '</dd></div><div><dt>Канал</dt><dd>' + esc(order.channel) + '</dd></div><div><dt>Общая сумма</dt><dd>' + money(order.totalKop) + '</dd></div><div><dt>Статус оплаты</dt><dd>' + esc(payments[order.paymentStatus]) + '</dd></div><div><dt>Фактически оплачено</dt><dd>' + (paid == null ? missing() : money(paid)) + '</dd></div><div><dt>Статус выполнения</dt><dd>' + esc(fulfillment[order.fulfillmentStatus]) + '</dd></div><div><dt>Доставка</dt><dd>' + shown(order.delivery) + '</dd></div><div><dt>Комментарий</dt><dd>' + shown(order.comment) + '</dd></div></dl><p class="pb-help">Прибыль считается по сумме строк. Названная сумма заказа, если она отличается, на прибыль не подставляется и скидкой не становится. Пустая оплата нулём не заменяется.</p></div>' : '') + '</article>';
  }
  function editor() {
    const order = state.editor;
    if (!order) return '';
    const editing = state.db.orders.some(item => item.id === order.id);
    const rows = order.lines.length ? order.lines : [];
    return '<section class="pb-editor" id="do-editor" tabindex="-1"><div class="pb-panel-title"><div><p class="market-eyebrow">КАРТОЧКА ЗАКАЗА</p><h3>' + (editing ? 'Редактировать заказ' : 'Новый прямой заказ') + '</h3></div><button type="button" class="pb-quiet" data-action="close-editor">Закрыть ✕</button></div><form id="do-form"><div class="pb-form-grid">' + field('Номер заказа', 'number', order.number, 'text', 'maxlength="80" placeholder="Не указано"') + field('Дата заказа', 'date', order.date, 'date', '') + field('Имя клиента', 'client', order.client, 'text', 'required maxlength="240" list="do-clients" placeholder="Имя клиента"') + field('Канал', 'channel', order.channel, 'text', 'required maxlength="80"') + field('Общая сумма, ₽', 'total', order.totalText, 'text', 'required inputmode="decimal" placeholder="0"') + '<label>Статус оплаты<select name="payment">' + options(Object.entries(payments), order.paymentStatus) + '</select></label>' + field('Фактически оплачено, ₽', 'paid', order.paidText, 'text', 'inputmode="decimal" placeholder="Не указано"') + '<label>Статус выполнения<select name="fulfillment">' + options(Object.entries(fulfillment), order.fulfillmentStatus) + '</select></label>' + field('Доставка', 'delivery', order.delivery, 'text', 'maxlength="2000" placeholder="Не указано"') + '</div><p class="pb-help">Пустая дата, номер, доставка и сумма оплаты сохраняются как «Не указано». Ноль в оплате записывается только если его ввести. Сумма заказа не означает, что деньги получены. Если сумма строк не равна сумме заказа, обе цифры сохраняются, разница не затирается.</p><input type="hidden" name="compositionNote" value="' + esc(order.compositionNote || '') + '"><input type="hidden" name="notedLineTotal" value="' + esc(order.notedLineTotal == null ? '' : order.notedLineTotal) + '"><input type="hidden" name="notedOrderTotal" value="' + esc(order.notedOrderTotal == null ? '' : order.notedOrderTotal) + '"><label class="do-check"><input type="checkbox" name="clarify"' + (order.clarify ? ' checked' : '') + '> Состав заказа требует уточнения</label>' + (order.clarify ? '<p class="do-clarify">' + esc(CLARIFY) + '</p><button type="button" class="pb-outline" data-action="add-line">Указать товары</button>' : '<div class="pb-table-wrap"><table class="pb-lines do-lines"><thead><tr><th>Артикул</th><th>Товар</th><th>Бренд</th><th>Количество</th><th>Цена продажи, ₽</th><th></th></tr></thead><tbody>' + rows.map((line, index) => '<tr data-line="' + index + '"><td><input aria-label="Артикул товара ' + (index + 1) + '" name="sku" list="do-catalog" value="' + esc(line.sku) + '" required maxlength="240"><input type="hidden" name="unit" value="' + esc(line.unit || '') + '"><input type="hidden" name="volume" value="' + esc(line.volume || '') + '"></td><td><input aria-label="Название товара ' + (index + 1) + '" name="name" value="' + esc(line.name) + '" required maxlength="240"></td><td><input aria-label="Бренд товара ' + (index + 1) + '" name="brand" value="' + esc(line.brand || '') + '" maxlength="240"></td><td><input aria-label="Количество товара ' + (index + 1) + '" name="qty" type="number" min="1" step="1" value="' + esc(line.qty) + '" required></td><td><input aria-label="Цена продажи товара ' + (index + 1) + '" name="price" inputmode="decimal" value="' + esc(line.priceText == null ? '' : line.priceText) + '" required></td><td><button class="pb-remove" type="button" data-remove-line="' + index + '" aria-label="Убрать товар ' + (index + 1) + '"' + (rows.length === 1 ? ' disabled' : '') + '>✕</button></td></tr>').join('') + '</tbody></table></div><p class="pb-help">Артикул выбирается из справочника товаров. Себестоимость подставляется из карточки, цена продажи вводится по этому заказу. На узком экране таблицу можно сдвинуть вбок.</p><button type="button" class="pb-outline" data-action="add-line">＋ Ещё товар</button>') + '<div id="do-preview" aria-live="polite"></div><label class="pb-note-field">Комментарий<textarea name="comment" maxlength="2000" placeholder="Не указано">' + esc(order.comment || '') + '</textarea></label><p id="do-form-error" class="pb-error" role="alert"></p><div class="pb-editor-actions"><span>Запись останется в этом браузере после обновления. Общий файл сайта виден с другого устройства.</span><button class="pb-primary" type="submit">Сохранить заказ</button></div></form></section>';
  }
  function kpi(label, value, note) {
    return '<article><span>' + esc(label) + '</span>' + value + '<p>' + note + '</p></article>';
  }
  function amount(kop, pending) {
    if (pending) return '<strong>…</strong>';
    if (kop == null) return '<strong class="do-kpi-missing">Не указано</strong>';
    return '<strong>' + money(kop) + '</strong>';
  }
  function homeCard() {
    const pending = !state.db || (!state.remoteSettled && !state.db.orders.length);
    const unavailable = !!(state.db && state.remoteError && !state.db.orders.length);
    const summary = pending || unavailable ? null : totals(state.db.orders);
    const count = pending ? '…' : (summary ? String(summary.count) : 'Не указано');
    const sum = pending ? '…' : (summary && summary.sumKop != null ? money(summary.sumKop) : 'Не указано');
    return '<a class="pb-direct-card" id="pb-direct-card" href="#direct-orders" aria-label="Прямые заказы клиентов, заказов ' + esc(count) + ', сумма ' + esc(sum) + '"><span class="pb-home-icon" aria-hidden="true">✎</span><div><p class="market-eyebrow">СТОРОННИЕ КЛИЕНТЫ</p><h3>Прямые заказы клиентов</h3><p>Оформлены лично или через переписку.</p></div><div class="pb-direct-metrics"><div><span>Заказов</span><strong>' + esc(count) + '</strong></div><div><span>Сумма заказов</span><strong>' + esc(sum) + '</strong></div></div><span class="pb-home-button">Открыть ↗</span></a>';
  }
  function paintCard() {
    const current = document.getElementById('pb-direct-card');
    if (!current) return;
    const holder = document.createElement('div');
    holder.innerHTML = homeCard();
    current.replaceWith(holder.firstElementChild);
  }
  function show() {
    const root = document.getElementById('do-root');
    if (root) mount(root.parentElement);
    paintCard();
  }
  function mount(container) {
    if (!state.db) state.db = read();
    const pending = !state.remoteSettled && !state.db.orders.length;
    const filtered = applyFilters(state.db.orders, state.filters);
    const summary = pending ? null : totals(filtered.orders);
    const clients = [...new Set(state.db.orders.map(order => order.client))].sort((a, b) => a.localeCompare(b, 'ru'));
    const saved = state.db.updatedAt ? 'сохранено ' + new Date(state.db.updatedAt).toLocaleString('ru-RU') : 'общий файл подключится при открытии';
    const paidNote = !summary ? 'Считаем известные оплаты' : summary.paidKop == null ? 'Сумма оплаты не подтверждена' : (summary.paidCount < summary.count ? 'По ' + summary.paidCount + ' из ' + summary.count + ' заказов' : 'По заказам с известной оплатой');
    const debtNote = !summary ? 'Только известный статус оплаты' : summary.debtKop == null ? 'Нет заказов с известным статусом оплаты' : (summary.debtCount < summary.count ? 'По ' + summary.debtCount + ' из ' + summary.count + ' заказов' : 'Статус оплаты известен');
    container.innerHTML = '<div class="pb-page do-page" id="do-root"><div class="pb-heading"><div><a class="do-back" href="#purchases">← К закупкам</a><p class="market-eyebrow">MA DISTRIBUTION / ПРЯМЫЕ ЗАКАЗЫ</p><h2>Прямые заказы клиентов</h2><p>Заказы сторонних клиентов, оформленные лично или через переписку.</p></div><button class="pb-primary" type="button" data-action="new-order">＋ Новый заказ</button></div><div class="pb-storage"><span>Общий файл сайта доступен с другого устройства. Правки этой страницы сохраняются в браузере и остаются после обновления · ' + esc(saved) + '</span><div><button type="button" data-action="backup">Сохранить копию</button></div></div>' + (state.storageError ? '<p class="pb-error" role="alert">' + esc(state.storageError) + '</p>' : '') + '<p class="pb-message" role="status">' + esc(state.message) + '</p>' + (state.error ? '<p class="pb-error" role="alert">' + esc(state.error) + '</p>' : '') + '<div class="pb-kpis">' + kpi('Заказов', pending ? '<strong>…</strong>' : '<strong>' + summary.count + '</strong>', 'В выбранных фильтрах') + kpi('Сумма заказов', amount(summary && summary.sumKop, pending), 'Сумма заказов, не оплата') + kpi('Фактически оплачено', amount(summary && summary.paidKop, pending), esc(paidNote)) + kpi('Задолженность', amount(summary && summary.debtKop, pending), esc(debtNote)) + '</div><form class="do-filters" id="do-filters"><label>Период с<input type="date" name="from" value="' + esc(state.filters.from) + '"></label><label>Период по<input type="date" name="to" value="' + esc(state.filters.to) + '"></label><label>Клиент<select name="client">' + options([['', 'Все клиенты'], ...clients.map(client => [client, client])], state.filters.client) + '</select></label><label>Статус оплаты<select name="payment">' + options([['all', 'Все статусы'], ...Object.entries(payments)], state.filters.payment) + '</select></label><label>Статус выполнения<select name="fulfillment">' + options([['all', 'Все статусы'], ...Object.entries(fulfillment)], state.filters.fulfillment) + '</select></label></form>' + (filtered.undated ? '<p class="pb-help">Заказов без даты, они не входят в выбранный период: ' + filtered.undated + '.</p>' : '') + editor() + '<div class="do-list">' + (filtered.orders.length ? filtered.orders.map(orderCard).join('') : '<div class="pb-empty"><span class="pb-empty-icon" aria-hidden="true">✎</span><h3>' + (state.db.orders.length ? 'В этих фильтрах заказов нет' : 'Прямых заказов пока нет') + '</h3><p>' + (state.db.orders.length ? 'Сбросьте период, клиента или статус.' : 'Добавьте заказ клиента, оформленный лично или в переписке.') + '</p></div>') + '</div><details class="pb-calculation"><summary>Как считаем сумму, оплату, задолженность и прибыль</summary><p>Сумма заказов — это сумма поля «Общая сумма». Она не подтверждает получение денег.</p><p>Фактически оплаченная сумма складывается только из заказов, где оплата указана. Пустое значение в сумму нулём не входит. Если таких заказов нет, показатель — «Не указано».</p><p>Задолженность считается только при известном статусе оплаты и согласованной сумме: не оплачен, частично оплачен или оплачен. Заказ со статусом «Не указано» в задолженность не входит.</p><p>Прибыль прямого заказа: цена продажи минус средняя закупка и доставка партии из журнала закупок, минус этикетка на флакон. Коробочка не входит, если товар ушёл в одной коробке. Налог не вычитается, если оплата на личную карту. Доставка клиенту не вычитается, если её оплатил клиент. Комиссия площадки не применяется. Если доставка до Москвы по позиции ещё не стоит в принятой партии, прибыль по ней — верхняя оценка.</p></details><datalist id="do-catalog">' + catalog().map(item => '<option value="' + esc(item.sku) + '">' + esc(item.name) + '</option>').join('') + '</datalist><datalist id="do-clients">' + clients.map(client => '<option value="' + esc(client) + '"></option>').join('') + '</datalist></div>';
    bind(container);
    preview();
  }
  function collect(form) {
    const order = state.editor;
    order.number = form.elements.number.value;
    order.date = form.elements.date.value;
    order.client = form.elements.client.value;
    order.channel = form.elements.channel.value;
    order.totalText = form.elements.total.value;
    order.paymentStatus = form.elements.payment.value;
    order.paidText = form.elements.paid.value;
    order.fulfillmentStatus = form.elements.fulfillment.value;
    order.delivery = form.elements.delivery.value;
    order.comment = form.elements.comment.value;
    order.compositionNote = form.elements.compositionNote.value;
    order.notedLineTotal = form.elements.notedLineTotal.value;
    order.notedOrderTotal = form.elements.notedOrderTotal.value;
    order.clarify = form.elements.clarify.checked;
    if (!order.clarify) {
      order.lines = [...form.querySelectorAll('[data-line]')].map(row => ({
        sku: row.querySelector('[name=sku]').value,
        name: row.querySelector('[name=name]').value,
        brand: row.querySelector('[name=brand]').value,
        qty: row.querySelector('[name=qty]').value,
        priceText: row.querySelector('[name=price]').value,
        unit: row.querySelector('[name=unit]') ? row.querySelector('[name=unit]').value : '',
        volume: row.querySelector('[name=volume]') ? row.querySelector('[name=volume]').value : ''
      }));
    }
    return order;
  }
  function preview() {
    const form = document.getElementById('do-form');
    const target = document.getElementById('do-preview');
    if (!form || !target) return;
    try {
      const order = normalOrder(structuredClone(collect(form)));
      const profit = orderProfit(order);
      const lineSum = order.lines.reduce((sum, line) => sum + line.qty * line.priceMinor, 0);
      target.innerHTML = '<div class="pb-cost-preview"><span>Сумма заказа <strong>' + money(order.totalKop) + '</strong></span><span>Товары <b>' + (order.lines.length ? money(lineSum) : 'состав не внесён') + '</b></span><span>Прибыль <b>' + (profit.state === 'known' ? money(profit.profitKop) : PROFIT_GAP) + '</b></span></div>' + (order.lines.length && lineSum !== order.totalKop ? '<p class="do-mismatch">Сумма строк ' + money(lineSum) + ' не равна сумме заказа ' + money(order.totalKop) + '.</p>' : '');
    } catch (error) {
      target.innerHTML = '<p class="pb-help">Итог появится, когда сумма и обязательные поля будут заполнены.</p>';
    }
  }
  function toDraft(order) {
    return {
      ...structuredClone(order),
      clarify: order.compositionStatus === 'needs-clarification',
      totalText: rubInput(order.totalKop),
      paidText: rubInput(order.paidKop),
      notedLineTotal: order.lines && order.lines.length ? lineTotal(order.lines) : '',
      notedOrderTotal: order.totalKop,
      lines: (order.lines || []).map(line => ({...line, priceText: rubInput(line.priceMinor)}))
    };
  }
  function commit(order) {
    const db = structuredClone(state.db);
    const index = db.orders.findIndex(item => item.id === order.id);
    if (db.orders.some(item => item.id !== order.id && identity(item) === identity(order))) fail('Такой заказ уже есть. Дубль не сохранён.');
    if (index < 0) db.orders.push(order);
    else {
      order.sourceRevision = db.orders[index].sourceRevision;
      order._sharedBase = db.orders[index]._sharedBase;
      db.orders[index] = order;
    }
    save(db);
    state.editor = null;
    state.openedId = order.id;
    state.message = 'Заказ сохранён. После обновления страницы он останется в этом браузере.';
    show();
    const card = document.getElementById('order-' + order.id);
    if (card) card.scrollIntoView({block: 'nearest'});
  }
  function download(name, data) {
    const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function bind(container) {
    const root = container.querySelector('#do-root');
    const filters = root.querySelector('#do-filters');
    filters.onchange = () => {
      const data = new FormData(filters);
      state.filters = {from: data.get('from'), to: data.get('to'), client: data.get('client'), payment: data.get('payment'), fulfillment: data.get('fulfillment')};
      if (state.editor) collect(document.getElementById('do-form'));
      show();
    };
    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      try {
        const action = button.dataset.action;
        if (action === 'new-order') {
          if (state.editor) fail('Сохраните или закройте открытую карточку.');
          state.editor = {id: uid(), number: '', date: '', client: '', channel: 'прямой заказ', clarify: true, totalText: '', paymentStatus: 'unknown', paidText: '', fulfillmentStatus: 'unknown', delivery: '', comment: '', lines: []};
          state.message = '';
          show();
          document.getElementById('do-editor').focus();
        }
        if (action === 'close-editor') { state.editor = null; show(); }
        if (action === 'add-line') {
          collect(document.getElementById('do-form'));
          state.editor.clarify = false;
          state.editor.lines.push({sku: '', name: '', brand: '', qty: 1, priceText: ''});
          show();
        }
        if (button.dataset.removeLine != null) {
          collect(document.getElementById('do-form'));
          state.editor.lines.splice(Number(button.dataset.removeLine), 1);
          show();
        }
        if (button.dataset.edit) {
          state.message = '';
          state.editor = toDraft(state.db.orders.find(order => order.id === button.dataset.edit));
          state.openedId = button.dataset.edit;
          show();
          document.getElementById('do-editor').focus();
        }
        if (button.dataset.open) {
          state.openedId = state.openedId === button.dataset.open ? null : button.dataset.open;
          show();
        }
        if (action === 'backup') {
          download('MA-pryamye-zakazy-' + today() + '.json', JSON.stringify(state.db, null, 2));
          state.message = 'Копия прямых заказов скачана.';
          show();
        }
      } catch (error) {
        state.error = error.message;
        show();
      }
    });
    const form = root.querySelector('#do-form');
    if (!form) return;
    form.addEventListener('input', () => { collect(form); preview(); });
    form.addEventListener('change', event => {
      collect(form);
      if (event.target.name === 'clarify') {
          if (!state.editor.clarify && !state.editor.lines.length) state.editor.lines.push({sku: '', name: '', brand: '', qty: 1, priceText: ''});
          show();
        }
      if (event.target.name === 'sku') {
        const row = event.target.closest('[data-line]');
        const index = Number(row.dataset.line);
        const product = catalog().find(item => norm(item.sku) === norm(event.target.value));
        if (product) {
          const line = state.editor.lines[index];
          if (!line.name) line.name = product.name;
          if (!line.brand) line.brand = product.brand;
          show();
        }
      }
    });
    form.onsubmit = event => {
      event.preventDefault();
      try {
        if (state.storageError) fail(state.storageError);
        commit(normalOrder(collect(form)));
      } catch (error) {
        const slot = root.querySelector('#do-form-error');
        if (slot) slot.textContent = error.message;
      }
    };
  }
  function absorb(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.orders)) return false;
    if (!state.db) state.db = read();
    if (state.storageError) return false;
    const result = appendOrders(state.db, data.orders);
    if (!result.changed) return false;
    save(result.db);
    state.message = result.conflicts ? 'Общий заказ обновлён. Поля с вашими отличающимися правками сохранены.' : 'Прямые заказы из общего файла добавлены или обновлены.';
    if (!state.editor) show();
    else paintCard();
    return true;
  }
  window.DirectOrders = {
    mount, homeCard,
    refreshCost: function () { if (document.getElementById('do-root') && !state.editor) show(); else paintCard(); },
    core: {validate, validateOrder, empty, totals, knownPaid, paymentFacts, orderProfit, lineEconomy, mergeShared, appendOrders, identity, normalOrder, applyFilters, moneyInput, channelPrep}
  };
  state.db = read();
  fetch('direct-orders.json', {cache: 'no-store'}).then(response => response.ok ? response.json() : null).then(data => {
    state.remoteSettled = true;
    if (!data) state.remoteError = true;
    let absorbed = false;
    try { absorbed = absorb(data); } catch (error) { state.error = 'Общий файл прямых заказов не подключён. ' + error.message; }
    if (!absorbed && !state.editor) show();
    else paintCard();
  }).catch(error => {
    state.remoteSettled = true;
    state.remoteError = true;
    state.error = 'Общий файл прямых заказов не загружен. ' + error.message;
    if (!state.editor) show();
    else paintCard();
  });
})();
