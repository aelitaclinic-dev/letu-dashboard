/* Aggregated executor reports. Purchase estimates stay in the existing SKU catalog. */
(function (root) {
  'use strict';
  const day = s => Date.parse(s + 'T00:00:00Z') / 86400000;
  const norm = s => String(s || '').trim().toLocaleLowerCase('ru');
  const kop = n => Math.round(Number(n) * 100);
  const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
  function catalog(data) {
    const map = new Map();
    (data.unitEconomics.groups || []).forEach(g => (g.items || []).forEach(i => {
      const row = Object.assign({}, g, i);
      delete row.items;
      const key = norm(row.article);
      map.set(key, map.has(key) ? null : row);
    }));
    return map;
  }
  function purchase(row) {
    if (!row) return null;
    if (row.rubPurchase != null) return kop(row.rubPurchase);
    return row.cnyPrice != null && row.rate != null ? kop(row.cnyPrice * row.rate) : null;
  }
  function freight(row) {
    if (!row) return null;
    if (row.freightExcluded) return 0;
    if (row.allocatedFreightRub != null) return kop(row.allocatedFreightRub);
    return row.weightKg != null && row.tariffRub != null ? kop(row.weightKg * row.tariffRub) : null;
  }
  function declarationShare(row, report) {
    if (!row.methodConfirmed) return null;
    if (row.allocationMethod === 'term' && row.validFrom && row.validTo) {
      const start = Math.max(day(row.validFrom), day(report.from));
      const end = Math.min(day(row.validTo), day(report.to));
      const length = day(row.validTo) - day(row.validFrom) + 1;
      return length > 0 ? Math.round(row.amountKop * Math.max(0, end - start + 1) / length) : null;
    }
    // Explicitly approved monthly management estimate, without inventing registration dates.
    if (row.allocationMethod === 'monthly-estimate' && row.allocationMonths > 0) {
      const daysInMonth = new Date(Date.UTC(+report.month.slice(0, 4), +report.month.slice(5), 0)).getUTCDate();
      return Math.round(row.amountKop / row.allocationMonths * (day(report.to) - day(report.from) + 1) / daysInMonth);
    }
    return null;
  }
  function calculate(data, report, expenses) {
    const byArticle = catalog(data), policy = data.letuFinance.costPolicy;
    let purchaseKop = 0, freightKop = 0, coveredRevenueKop = 0;
    let coveredCommissionKop = 0, coveredPositiveQty = 0, missingPositiveQty = 0;
    const missingArticles = [], costRows = [];
    for (const item of report.products) {
      const row = byArticle.get(norm(item.article));
      const unitPurchase = purchase(row), unitFreight = freight(row);
      const netQty = item.saleQty - item.returnQty;
      if (unitPurchase == null || unitFreight == null) {
        missingArticles.push({article:item.article, name:item.name, qty:netQty, revenueKop:item.revenueKop,
          reason:row ? 'Не заполнена закупка или доставка в карточке SKU' : 'Артикул не найден в сохранённой юнит-экономике'});
        missingPositiveQty += item.saleQty;
      } else {
        purchaseKop += unitPurchase * netQty;
        freightKop += unitFreight * netQty;
        coveredRevenueKop += item.revenueKop;
        coveredCommissionKop += item.commissionKop;
        coveredPositiveQty += item.saleQty;
      }
      costRows.push({article:item.article, name:item.name, saleQty:item.saleQty, returnQty:item.returnQty,
        netQty, unitPurchaseKop:unitPurchase, unitFreightKop:unitFreight,
        purchaseKop:unitPurchase == null ? null : unitPurchase * netQty,
        freightKop:unitFreight == null ? null : unitFreight * netQty});
    }
    const total = report.totals;
    const revenueKop = total.realizationKop + total.returnsKop;
    const positiveQty = sum(report.products, 'saleQty'), returnQty = sum(report.products, 'returnQty');
    const labelKop = positiveQty * policy.productLabelKop;
    const taxRate = data.unitEconomics.taxRate;
    const taxKop = Math.round(revenueKop * taxRate);
    const gaps = [], includedBusinessExpenseIds = [];
    let declarationKnownKop = 0, declarationUnknown = false, declarationCount = 0;
    let monthlyRawKop = 0, monthlyRoundedKop = 0;
    for (const r of expenses) {
      if (r.entity !== 'ip' || r.channelScope !== 'letu' || r.category !== 'declarations') continue;
      declarationCount++;
      let amount = declarationShare(r, report);
      if (amount != null && r.allocationMethod === 'monthly-estimate') {
        const daysInMonth = new Date(Date.UTC(+report.month.slice(0,4), +report.month.slice(5), 0)).getUTCDate();
        monthlyRawKop += r.amountKop / r.allocationMonths * (day(report.to)-day(report.from)+1)/daysInMonth;
        amount = Math.round(monthlyRawKop) - monthlyRoundedKop;
        monthlyRoundedKop += amount;
      }
      if (amount == null) { declarationUnknown = true; gaps.push((r.title || 'Декларация') + ': срок действия или правило распределения не подтверждены'); }
      else { declarationKnownKop += amount; includedBusinessExpenseIds.push(r.id); }
    }
    if (!declarationCount) { declarationUnknown = true; gaps.push('Декларации: нет записей для этого кабинета'); }
    const delivery = data.letuFinance.deliveries[report.month] || {};
    const courierKop = delivery.count == null ? null : delivery.count * policy.deliveryPerTripKop;
    if (courierKop == null) gaps.push('Доставка на склад: количество рейсов за период пока неизвестно');
    else includedBusinessExpenseIds.push('letu-delivery-' + report.month);
    for (const r of missingArticles) gaps.push(r.article + ': ' + r.reason);
    const goodsKop = purchaseKop + freightKop;
    const accountedKop = goodsKop + labelKop + total.commissionKop + taxKop + total.marketingKop
      + (courierKop == null ? 0 : courierKop) + declarationKnownKop;
    const resultKop = revenueKop - accountedKop;
    const complete = !missingArticles.length && !declarationUnknown && courierKop != null;
    const coveredResultKop = coveredRevenueKop - goodsKop - coveredPositiveQty * policy.productLabelKop
      - coveredCommissionKop - Math.round(coveredRevenueKop * taxRate) - total.marketingKop
      - (courierKop == null ? 0 : courierKop) - declarationKnownKop;
    return {
      month:report.month, status:report.partial ? 'Неполный месяц' : 'Полный отчёт исполнителя', partial:report.partial,
      comparable:!report.partial && complete, resultKind:missingArticles.length ? 'remainder' : 'preliminary',
      resultKop, coveredResultKop, turnoverKop:total.realizationKop, turnoverQty:positiveQty,
      returnsKop:total.returnsKop, returnsQty:returnQty, revenueKop, purchaseKop, freightKop,
      freightChargedQty:costRows.filter(r=>r.unitFreightKop > 0).reduce((s,r)=>s+r.netQty,0),
      freightExcludedQty:costRows.filter(r=>r.unitFreightKop === 0).reduce((s,r)=>s+r.netQty,0),
      freightGapRevenueKop:0, goodsKop, labelKop, labelQty:positiveQty, labelUnknownQty:0,
      boxLabelKop:0, boxLabelQty:0, boxLabelExcludedQty:positiveQty, boxLabelUnknownQty:0,
      boxKop:0, boxQty:0, boxExcludedQty:positiveQty, boxUnknownQty:0,
      packerKop:0, packerQty:0, packerExcludedQty:positiveQty, filmKop:0, filmQty:0,
      filmStatus:'Не применяется в этой модели поставки', prepKop:labelKop,
      materialsKop:0, materialsState:'excluded', warehouseKop:0, warehouseState:'excluded',
      declarationKop:declarationUnknown ? null : declarationKnownKop, declarationKnownKop,
      declarationState:declarationUnknown ? 'unallocated' : 'estimate', declarationCashKop:null,
      courierKop, deliveryCount:delivery.count == null ? null : delivery.count,
      deliveryStatus:delivery.status || 'Не заполнено', taxKop, taxRate, taxStatus:'Оценка по прежней модели ИП',
      commissionKop:total.commissionKop, commissionReportKop:total.commissionKop,
      commissionLineKop:sum(report.commissionRows, 'withheldKop'),
      commissionGapKop:total.commissionKop - sum(report.commissionRows, 'withheldKop'),
      commissionRows:report.commissionRows, adsKop:total.marketingKop, accountedKop,
      coveredRevenueKop, filledRevenueKop:coveredRevenueKop, filledShare:revenueKop ? coveredRevenueKop/revenueKop : 0,
      confirmedShare:0, missingPositiveQty, missingArticles, unconfirmed:[], disputed:[], disputedRefusedKop:0,
      expensesComplete:complete, pendingExpenses:gaps, includedBusinessExpenseIds,
      costPolicy:'letu-bulk-2026-10', costRows, source:report.source,
      financeStart:report.from, financeEnd:report.to, start:report.from, end:report.to,
      notes:[
        'Выручка и фактическая комиссия взяты из отчёта исполнителя. Скидка площадки учтена в удержании и повторно не вычитается.',
        'Аванс и остаток к доплате относятся к расчётам с площадкой, а не к затратам или прибыли.',
        'Себестоимость взята из сохранённых карточек SKU. Это прежняя оценка, а не подтверждение себестоимости проданной партии.',
        'Международная доставка внутри себестоимости товара учтена один раз; доставка партии на склад Л’Этуаль — отдельная строка.',
        'На каждую проданную единицу — одна наклейка по ' + policy.productLabelKop/100 + ' ₽. Возврат не отменяет уже использованную наклейку.',
        'Индивидуальная коробка, наклейка на коробку, плёнка и отдельная работа упаковщика исключены по пояснению пользователя от 21.11.2026.',
        'Расчётный налог — ' + Math.round(taxRate*100) + '% от выручки после возвратов до комиссии, по прежней управленческой модели ИП.',
        'Стоимость возвращённого товара восстанавливается в расчёте себестоимости по прежней модели. Состояние возврата требует складской сверки.',
        'Доставка — оценка 3 000 ₽ × количество партий в отчётном периоде. Не является подтверждением оплаты водителю.',
        'Декларации ИП учитываются долей за период, когда подтверждён срок. Расходы ООО и повторное списание полной оплаты исключены.'
      ].concat(gaps)
    };
  }
  function apply(data, expenses) {
    if (!data.letuFinance) return;
    expenses = expenses || data.businessExpenses.records;
    for (const report of data.letuFinance.reports) {
      const row = data.profit.months.find(r=>r.month===report.month);
      if (!row) continue;
      const view = calculate(data, report, expenses);
      row.view = view;
      Object.assign(row, {partial:report.partial, revenueState:report.partial?'partial':'known',
        revenueKop:view.revenueKop, saleKop:view.turnoverKop, cogsKop:view.goodsKop,
        cogsState:view.missingArticles.length?'not_calculated':'known', grossState:view.missingArticles.length?'not_calculated':'known',
        commissionState:'known', commissionKop:view.commissionKop, commissionReportKop:view.commissionReportKop,
        commissionLineKop:view.commissionLineKop, commissionGapKop:view.commissionGapKop,
        preliminaryState:report.partial?'partial':'preliminary', preliminaryKop:view.resultKop,
        filmQty:0, filmKop:0, filmStatus:'Не применяется', filmRateKop:0,
        adsState:'known', adsKop:view.adsKop, logisticsState:view.courierKop==null?'missing':'known',
        storageState:'known', returnsHandlingState:'known', taxState:'known', taxKop:view.taxKop,
        profitState:view.expensesComplete?'preliminary':'not_calculated'});
    }
  }
  const api = {apply, calculate, declarationShare};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.LetuFinance = api; if (root.DASHBOARD) apply(root.DASHBOARD); }
})(typeof window !== 'undefined' ? window : globalThis);
