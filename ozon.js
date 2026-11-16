/* Ozon aggregates only. This browser never receives marketplace credentials. */
(function () {
  'use strict';
  var snapshot = null;
  var months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(v) { return Number.isSafeInteger(v) ? (v/100).toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₽' : 'Нет данных'; }
  function qty(v) { return Number.isSafeInteger(v) ? String(v) : 'Нет данных'; }
  function day(v) { return String(v || '').slice(0,10).split('-').reverse().join('.'); }
  function ready(v) { return v && v.state === 'ready'; }
  function label(row) { return months[Number(row.month.slice(-2))-1]; }
  function card(title, value, note) { return '<div class="market-empty-metric"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>'; }
  function table(headers, rows) { return '<div class="ozon-table-wrap"><table class="ozon-table"><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(row){return '<tr>'+row.map(function(c){return '<td>'+esc(c)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>'; }
  function selected(state) { return (snapshot ? snapshot.months : []).filter(function(m) { return m.state !== 'future' && m.fromDate >= state.from && m.toDate <= state.to; }); }
  function total(rows, source, key) {
    var accepted = rows.filter(function(r) { return ready(r[source]) && Number.isSafeInteger(r[source][key]); });
    return {value: accepted.length ? accepted.reduce(function(s,r){return s+r[source][key];},0) : null, count:accepted.length, complete:accepted.length===rows.length && rows.length>0};
  }
  function opsTotal(rows, key) {
    var accepted = rows.filter(function(r) { return ready(r.operations) && Number.isSafeInteger(r.operations[key]); });
    return {value: accepted.length ? accepted.reduce(function(s,r){return s+r.operations[key];},0) : null, count:accepted.length, complete:accepted.length===rows.length && rows.length>0};
  }
  function accTotal(rows, key) {
    var accepted = rows.filter(function(r) { return ready(r.accruals) && Number.isSafeInteger(r.accruals[key]); });
    return {value: accepted.length ? accepted.reduce(function(s,r){return s+r.accruals[key];},0) : null, count:accepted.length, complete:accepted.length===rows.length && rows.length>0};
  }
  function totals(state) {
    var rows=selected(state), sold=total(rows,'sales','salesKop'), returned=total(rows,'sales','returnsKop');
    return {rows:rows,sold:sold,returned:returned,net:sold.value==null||returned.value==null?null:sold.value-returned.value,
      salesQty:total(rows,'sales','salesQty'), returnsQty:total(rows,'sales','returnsQty'), paid:total(rows,'balance','paidKop'),
      accrued:total(rows,'balance','accruedKop'), ordered:opsTotal(rows,'orderedQty'), cancelled:opsTotal(rows,'cancelledQty'),
      delivered:opsTotal(rows,'deliveredQty'), returnedOps:opsTotal(rows,'returnedQty'),
      commission:accTotal(rows,'commissionKop'), logistics:accTotal(rows,'logisticsKop'), storage:accTotal(rows,'storageKop'),
      services:accTotal(rows,'servicesKop'), fines:accTotal(rows,'finesKop'), compensation:accTotal(rows,'compensationKop'),
      adjustments:accTotal(rows,'adjustmentsKop')};
  }
  function coverage(metric, rows) { return metric.complete ? 'Полный выбранный период' : 'Только доступные отчёты: '+metric.count+' из '+rows.length+' мес.'; }
  function periodForm(state) { return '<form class="market-period" id="period-filter"><div class="period-caption">Период отчётов</div><label>С даты<input type="date" name="from" required value="'+esc(state.from)+'"></label><label>По дату<input type="date" name="to" required value="'+esc(state.to)+'"></label><button type="submit">Применить</button></form>'; }
  function bankMoney(state) {
    if (!window.BankLedger || !window.BankLedger.evidence) return {html: card('Подтверждено выпиской банка','Не сверено','Нужна банковская выписка за выбранный период'), amount: null};
    var evidence = window.BankLedger.evidence('ozon-ooo', state);
    if (!evidence) return {html: window.BankLedger.bankCard('ozon-ooo', state), amount: null};
    return {html: window.BankLedger.bankCard('ozon-ooo', state), amount: evidence.amountKop};
  }
  function missingList() {
    var rows = snapshot.unavailableReports || [];
    if (!rows.length) return '<p class="ozon-caption">Пробелов по запрошенным источникам нет, кроме исторических остатков, если они отмечены отдельно.</p>';
    return '<h3>Недоступные отчёты</h3>'+table(['Месяц','Источник','Статус'], rows.map(function(r){
      return [r.month ? r.month : 'Период', r.source, r.label || 'Нет данных'];
    }));
  }
  function summary(state) {
    var t=totals(state), s=snapshot.stocks, stock=ready(s)?s.rows.reduce(function(a,r){return a+(Number.isSafeInteger(r.available)?r.available:0);},0):null;
    var bank=bankMoney(state), debt=snapshot.debt;
    var html='<div class="market-empty-metrics">'+card('Продажи после возвратов',money(t.net),coverage(t.sold,t.rows)+' · отчёт реализации, не заказы')
      +card('Начислено после удержаний',money(t.accrued.value),coverage(t.accrued,t.rows)+' · итог баланса, комиссии повторно не вычитаются')
      +card('Перечислено по данным Ozon',money(t.paid.value),coverage(t.paid,t.rows))
      +bank.html+'</div>';
    html+='<div class="market-empty-metrics">'+card('Продано / возвращено',t.salesQty.value==null?'Нет данных':t.salesQty.value+' / '+(t.returnsQty.value==null?'Нет данных':t.returnsQty.value)+' шт.','Выкуп по реализации')
      +card('Заказы / отмены / выкупы', [qty(t.ordered.value), qty(t.cancelled.value), qty(t.delivered.value)].join(' / '),'Оперативные отправления; не подтверждённые продажи')
      +card('Доступно к продаже сейчас',stock==null?'Нет данных':stock+' шт.','Снимок остатков; не зависит от периода')
      +(ready(debt)?card('Баланс у Ozon',money(debt.closingKop),'На '+day(debt.asOf)+(debt.ozonOwesSellerKop?' · задолженность Ozon перед продавцом '+money(debt.ozonOwesSellerKop):'')):'')+'</div>';
    html+='<h3>Продажи и выплаты по месяцам · '+snapshot.year+'</h3><p class="ozon-caption">Продажи — цена продавца × количество из отчёта реализации. Заказы и отмены в эту сумму не входят. Начисления уже после комиссий, логистики, хранения, штрафов и услуг площадки.</p>';
    html+=table(['Месяц','Продано, шт.','Продажи','Возвращено, шт.','Возвраты','После возвратов','Начислено на баланс','Перечислено Ozon','Полнота'],snapshot.months.map(function(m){
      if(m.state==='future') return [label(m),'—','—','—','—','—','—','—','Период не наступил'];
      var a=m.sales,b=m.balance, ok=ready(a), bk=ready(b);
      return [label(m)+(m.partial?' · по '+day(m.toDate)+', месяц не закрыт':''),ok?a.salesQty:'—',ok?money(a.salesKop):'Нет данных',ok?a.returnsQty:'—',ok?money(a.returnsKop):'Нет данных',ok?money(a.salesKop-a.returnsKop):'Нет данных',bk?money(b.accruedKop):'Нет данных',bk?money(b.paidKop):'Нет данных',m.partial?'Предварительные данные':ok&&bk&&b.paymentReconciled?'Отчёты получены':'Есть пробелы'];
    }));
    html+='<h3>Оперативные заказы, отмены и выкупы</h3><p class="ozon-caption">Это статусы отправлений FBS/FBO. Они не заменяют отчёт реализации и не считаются подтверждённой продажей.</p>';
    html+=table(['Месяц','Заказано, шт.','Отменено, шт.','Выкуплено, шт.','Возвраты отправлений, шт.','В работе, шт.','Характер'],snapshot.months.map(function(m){
      if(m.state==='future') return [label(m),'—','—','—','—','—','Период не наступил'];
      var o=m.operations;
      if(!ready(o)) return [label(m),'Нет данных','Нет данных','Нет данных','Нет данных','Нет данных','Нет данных'];
      return [label(m),o.orderedQty,o.cancelledQty,o.deliveredQty,o.returnedQty,o.inProgressQty, m.partial||o.preliminary?'Предварительно':'По статусам отправлений'];
    }));
    html+=missingList();
    html+='<p class="ozon-caption">Таблица показывает весь год. Карточки выше учитывают только отчётные месяцы, целиком попавшие в выбранные даты. Незагруженные месяцы не считаются нулевыми. Общие расходы ООО (декларации, госпошлины, взносы) здесь не распределяются по площадкам.</p>';
    return html;
  }
  function payouts(state) {
    var t=totals(state), bank=bankMoney(state);
    var html='<div class="market-empty-metrics">'+card('Начислено на баланс',money(t.accrued.value),coverage(t.accrued,t.rows))+card('Перечислено Ozon',money(t.paid.value),coverage(t.paid,t.rows))+bank.html+'</div>';
    html+='<p>Четыре потока считаются отдельно: продажи, начисления после удержаний, перечисления Ozon и фактические поступления по выписке. Выплаты не складываются с выручкой и не являются прибылью.</p>';
    html+=table(['Период','Баланс на начало','Начислено','Перечислено','Баланс на конец','Проверка'],t.rows.map(function(m){var b=m.balance;return ready(b)?[day(m.fromDate)+'–'+day(m.toDate),money(b.openingKop),money(b.accruedKop),money(b.paidKop),money(b.closingKop),b.paymentReconciled?'Начало + начисления − выплаты = конец':'Выплаты требуют сверки']:[label(m),'Нет данных','Нет данных','Нет данных','Нет данных','Нет данных'];}));
    html+='<p class="ozon-caption">Сверка: начальный баланс + начисления − выплаты = конечный баланс. Если равенство не выполняется до копейки, сумма выплат не подменяется расчётной.</p>';
    var pay=snapshot.payouts;
    if(ready(pay) && pay.rows && pay.rows.length) html+='<h3>Перечисления Ozon по датам</h3>'+table(['Дата','Сумма'],pay.rows.filter(function(r){return r.date>=state.from&&r.date<=state.to;}).map(function(r){return [day(r.date),money(r.amountKop)];}));
    else html+='<h3>Перечисления Ozon по датам</h3><p>Нет данных. Нулевой итог показывается только если отчёт выплат получен и в нём подтверждён ноль.</p>';
    var cf=snapshot.cashflow;
    if(ready(cf)) html+='<h3>Контрольные отчёты выплат Ozon</h3><p>Периоды финансового отчёта. Это не дата банковского перевода и не повторное сложение с балансом.</p>'+table(['С периода','По период','Выплаты в исходном отчёте','Начальный баланс','Конечный баланс'],cf.details.filter(function(r){return r.fromDate>=state.from&&r.toDate<=state.to;}).map(function(r){return [day(r.fromDate),day(r.toDate),money(r.reportedPaymentsKop),money(r.openingKop),money(r.closingKop)];}));
    html+='<p><a href="#bank/ooo">Банковская сверка ООО «КЛМ»</a> · <a href="#expenses">Общие расходы ООО</a></p>';
    return html;
  }
  function expenses(state) {
    var t=totals(state);
    var html='<div class="market-empty-metrics">'+card('Комиссии',money(t.commission.value),coverage(t.commission,t.rows))
      +card('Логистика',money(t.logistics.value),coverage(t.logistics,t.rows))
      +card('Хранение',money(t.storage.value),coverage(t.storage,t.rows))
      +card('Прочие услуги Ozon',money(t.services.value),coverage(t.services,t.rows))+'</div>';
    html+='<p class="ozon-caption">Эти суммы уже входят в «начислено после удержаний». Второй раз из продаж они не вычитаются. Общие платежи ООО (декларации, госпошлины, страховые взносы) остаются в разделе расходов бизнеса и по площадкам не раскладываются.</p>';
    html+=table(['Месяц','Комиссии','Логистика','Хранение','Прочие услуги','Компенсации','Корректировки'],snapshot.months.map(function(m){
      if(m.state==='future') return [label(m),'—','—','—','—','—','—'];
      var a=m.accruals;
      if(!ready(a)) return [label(m),'Нет данных','Нет данных','Нет данных','Нет данных','Нет данных','Нет данных'];
      return [label(m)+(m.partial?' · предварительно':''),money(a.commissionKop),money(a.logisticsKop),money(a.storageKop),money(a.servicesKop),money(a.compensationKop),money(a.adjustmentsKop)];
    }));
    var cf=snapshot.cashflow;
    if(ready(cf)) html+='<h3>Контроль по финансовому отчёту Ozon</h3><p>Знаки сохранены как в отчёте. Таблица не прибавляется к таблице начислений.</p>'+table(['Период','Заказы в отчёте','Возвраты','Комиссия','Услуги','Логистика'],cf.periods.filter(function(r){return r.fromDate>=state.from&&r.toDate<=state.to;}).map(function(r){return [day(r.fromDate)+'–'+day(r.toDate),money(r.ordersKop),money(r.returnsKop),money(r.commissionKop),money(r.servicesKop),money(r.logisticsKop)];}));
    html+='<p><a href="#expenses">Декларации, госпошлины и взносы ООО</a></p>';
    return html;
  }
  function fines(state) {
    var t=totals(state);
    var html='<div class="market-empty-metrics">'+card('Штрафы и удержания',money(t.fines.value),coverage(t.fines,t.rows))+card('Компенсации',money(t.compensation.value),coverage(t.compensation,t.rows))+card('Корректировки',money(t.adjustments.value),coverage(t.adjustments,t.rows))+'</div>';
    html+='<p>Штрафы показаны отдельно и уже учтены в итоговом начислении баланса. Из продаж повторно не вычитаются.</p>';
    html+=table(['Месяц','Штрафы и удержания','Компенсации','Корректировки','Расшифровка типов'],snapshot.months.map(function(m){
      if(m.state==='future') return [label(m),'—','—','—','—'];
      var a=m.accruals;
      if(!ready(a)) return [label(m),'Нет данных','Нет данных','Нет данных','Нет данных'];
      var types=(a.types||[]).filter(function(x){ var b=x.name||''; return /штраф|удерж|fine|penalty|компенс|корректир/i.test(b); }).map(function(x){ return x.name+': '+money(x.amountKop); }).join('; ');
      return [label(m),money(a.finesKop),money(a.compensationKop),money(a.adjustmentsKop), types || 'Отдельных типов нет'];
    }));
    return html;
  }
  function stock() {
    var s=snapshot.stocks;
    if(!ready(s)) return '<p>Остатки не получены. Нет данных не означает нулевой склад.</p>';
    var html='<p>Текущий снимок: '+esc((s.asOf||'').replace('T',' ').slice(0,19))+' МСК. Исторические остатки на конец предыдущих месяцев API-выгрузкой не восстановлены.</p>';
    var fbs=s.rows.filter(function(r){return r.scheme!=='FBO';}), fbo=s.rows.filter(function(r){return r.scheme==='FBO';});
    function sumField(rows, field){ var ok=rows.every(function(r){return Number.isSafeInteger(r[field]);}); return ok?rows.reduce(function(a,r){return a+r[field];},0):null; }
    html+='<div class="market-empty-metrics">'+card('В наличии FBS/rFBS',sumField(fbs,'present')==null?'Нет данных':sumField(fbs,'present')+' шт.','Только FBS/rFBS')+card('Зарезервировано FBS/rFBS',sumField(fbs,'reserved')==null?'Нет данных':sumField(fbs,'reserved')+' шт.','Резерв FBO отдельно')+card('Доступно FBS/rFBS',sumField(fbs,'available')==null?'Нет данных':sumField(fbs,'available')+' шт.','present − reserved')+card('Доступно FBO',s.fboState==='ready'?(sumField(fbo,'available')==null?'Нет данных':sumField(fbo,'available')+' шт.'):'Нет данных','Наличие и резерв FBO API не передал')+'</div>';
    html+=table(['Артикул продавца','Товар','Схема','Склад','В наличии','Резерв','Доступно'],s.rows.map(function(r){return [r.article,r.name,r.scheme,r.warehouse,r.present==null?'Не передаётся':r.present,r.reserved==null?'Не передаётся':r.reserved,r.available];}));
    if(s.warehouseDetailState!=='ready') html+='<p class="ozon-caption">Разбивка по отдельным складам получена не полностью. Итоги по схемам не суммируются повторно с детализацией.</p>';
    if(s.fboState && s.fboState!=='ready') html+='<p class="ozon-caption">Остатки FBO не получены; они не включены в итог.</p>';
    return html;
  }
  function products(state) {
    var items={};
    selected(state).forEach(function(m){if(!ready(m.sales))return;m.sales.products.forEach(function(p){var r=items[p.article]||(items[p.article]={article:p.article,name:p.name,salesQty:0,returnsQty:0,salesKop:0,returnsKop:0});['salesQty','returnsQty','salesKop','returnsKop'].forEach(function(k){r[k]+=p[k];});});});
    var html='<p>Реализация по артикулам за полученные полные отчётные месяцы. Это выкупы из отчёта реализации, не заказы.</p>'+table(['Артикул','Товар','Продано','Возвращено','Продажи','Возвраты','После возвратов'],Object.keys(items).sort().map(function(k){var p=items[k];return [p.article,p.name,p.salesQty,p.returnsQty,money(p.salesKop),money(p.returnsKop),money(p.salesKop-p.returnsKop)];}));
    var ops={};
    selected(state).forEach(function(m){if(!ready(m.operations))return;m.operations.products.forEach(function(p){var r=ops[p.article]||(ops[p.article]={article:p.article,name:p.name,orderedQty:0,cancelledQty:0,deliveredQty:0,returnedQty:0});['orderedQty','cancelledQty','deliveredQty','returnedQty'].forEach(function(k){r[k]+=p[k];});});});
    html+='<h3>Оперативные отправления по артикулам</h3><p>Предварительные статусы. В продажи сводки не добавлены.</p>'+table(['Артикул','Товар','Заказано','Отменено','Выкуплено','Возвраты отправлений'],Object.keys(ops).sort().map(function(k){var p=ops[k];return [p.article,p.name,p.orderedQty,p.cancelledQty,p.deliveredQty,p.returnedQty];}));
    return html;
  }
  function profit() {
    return '<h3>Чистая прибыль не рассчитана</h3><p>Для прибыли ООО «КЛМ» на Ozon не хватает подтверждённой себестоимости по партиям, полного состава расходов и налогов. Продажи, начисления и перечисления есть в соседних вкладках; отсутствующие затраты не приняты за ноль.</p><ul><li>Себестоимость по партиям закупок — не сопоставлена с артикулами Ozon.</li><li>Комиссии, логистика, хранение и штрафы уже внутри начисления баланса и второй раз не вычитаются.</li><li>Декларации, госпошлины и страховые взносы ООО учитываются отдельно и между площадками не распределяются.</li></ul><p><a class="button secondary" href="#expenses">Расходы ИП / ООО</a> · <a class="button secondary" href="#purchases">Закупки</a></p>';
  }
  function sources() {
    return '<details class="fold ozon-sources"><summary>Источники и точность цифр</summary><p>Продажи и возвраты: месячные отчёты реализации Ozon, цена продавца × количество. Отмены и невыкупы в продажи не добавляются. Начисления и перечисления: отчёт баланса Ozon. Комиссии, логистика, хранение, штрафы и услуги: ежедневные начисления Ozon; они уже внутри итогового начисления и повторно не вычитаются.</p><p>Оперативные заказы — статусы отправлений FBS/FBO. Для незакрытого месяца это предварительные данные. Остатки: текущий снимок API. Исторические остатки не восстанавливаются. Пустой или недоступный отчёт показывается как «Нет данных», а не как ноль.</p><p>Фактические поступления — только банковская выписка ООО. Проверка равенства баланса: начало + начисления − выплаты = конец.</p></details>';
  }
  function render(section, state, store) {
    var allowed=['summary','unit','profit','payouts','stock','expenses','fines'];
    var active=allowed.indexOf(section)>=0?section:'summary';
    var tabs=[['summary','Сводка'],['unit','Товары'],['payouts','Выплаты'],['expenses','Расходы Ozon'],['fines','Штрафы'],['stock','Остатки'],['profit','Прибыль']];
    var html='<div class="market-heading"><p class="market-eyebrow">OZON / ООО «КЛМ»</p><h2>Продажи, склад и деньги</h2><p>Раздельный учёт реализации, начислений, перечислений и банка.</p></div><div class="market-store-bar"><nav class="store-switch" aria-label="Магазины Ozon">'+[['all','Все магазины'],['ip','ИП'],['ooo','ООО «КЛМ»']].map(function(r){return '<a href="#ozon/'+r[0]+'/'+active+'"'+(store===r[0]?' class="selected" aria-current="page"':'')+'>'+r[1]+'</a>';}).join('')+'</nav><span class="market-status '+(snapshot?'connected':'pending')+'">'+(snapshot?'ООО: отчёты получены':'ООО: данные ещё не опубликованы')+'</span></div>';
    html+=periodForm(state)+'<nav class="market-sections" aria-label="Разделы Ozon">'+tabs.map(function(r){return '<a href="#ozon/'+store+'/'+r[0]+'"'+(active===r[0]?' class="selected" aria-current="page"':'')+'>'+r[1]+'</a>';}).join('')+'</nav>';
    if(store==='ip') return html+'<section class="market-empty-state"><h3>Ozon ИП ещё не подключён</h3><p>Данные ООО «КЛМ» доступны отдельно.</p></section>';
    if(store==='all') html+='<p class="ozon-caption">Показаны только данные ООО «КЛМ». Кабинет ИП пока не включён в общий итог.</p>';
    if(!snapshot) return html+'<section class="market-empty-state"><div><h3>Загрузка отчётов подготовлена</h3><p>Сводные цифры пока не опубликованы. Отсутствующие значения не считаются нулевыми продажами или выплатами.</p></div></section>';
    html+='<p class="ozon-caption">Обновлено '+esc(snapshot.generatedAt.replace('T',' ').slice(0,19))+' МСК · '+day(snapshot.fromDate)+'–'+day(snapshot.toDate)+'</p>';
    if(active==='summary') html+=summary(state);
    else if(active==='payouts') html+=payouts(state);
    else if(active==='expenses') html+=expenses(state);
    else if(active==='fines') html+=fines(state);
    else if(active==='stock') html+=stock();
    else if(active==='unit') html+=products(state);
    else html+=profit();
    return html+sources();
  }
  function tile(state) {
    var t=totals(state);
    return '<a class="market-tile market-ozon" href="#ozon/ooo/summary"><div class="market-tile-top"><span class="market-symbol">O</span><span class="market-status '+(snapshot?'connected':'pending')+'">'+(snapshot?'ООО: отчёты получены':'Подготовлено подключение')+'</span></div><h3>Ozon</h3><p class="market-store-caption">ООО «КЛМ» · ИП пока не подключён</p><div class="market-sales"><span>Продажи после возвратов</span><strong>'+esc(money(t.net))+'</strong><small>'+esc(snapshot?coverage(t.sold,t.rows):'Сводные цифры ещё не опубликованы')+'</small></div><dl class="market-tile-details"><div><dt>Начислено после удержаний</dt><dd>'+esc(money(t.accrued.value))+'</dd></div><div><dt>Перечислено Ozon</dt><dd>'+esc(money(t.paid.value))+'</dd></div><div><dt>Чистая прибыль</dt><dd>Не рассчитана</dd></div></dl><p class="market-data-note">Реализация, баланс, штрафы и текущие остатки — в отдельных разделах.</p><span class="market-open">Открыть ООО «КЛМ» ↗</span></a>';
  }
  function validate(data) {
    if(!data || data.schemaVersion!==1 || data.owner!=='ooo' || !Number.isInteger(data.year) || !Array.isArray(data.months) || data.months.length!==12 || typeof data.generatedAt!=='string') return false;
    return data.months.every(function(m){if(m.state==='future') return /^\d{4}-\d{2}$/.test(m.month);var s=m.sales,b=m.balance;return /^\d{4}-\d{2}$/.test(m.month)&&typeof m.fromDate==='string'&&typeof m.toDate==='string'&&s&&b&&(!ready(s)||(['salesQty','returnsQty','salesKop','returnsKop','reportAccruedKop'].every(function(k){return Number.isSafeInteger(s[k]);})&&Array.isArray(s.products)))&&(!ready(b)||(['openingKop','closingKop','accruedKop','reportedPaymentsKop'].every(function(k){return Number.isSafeInteger(b[k]);})&&(b.paidKop===null||Number.isSafeInteger(b.paidKop))));}) && data.stocks && (!ready(data.stocks)||Array.isArray(data.stocks.rows)&&data.stocks.rows.every(function(r){return typeof r.article==='string'&&Number.isSafeInteger(r.available)&&r.available>=0&&((r.present===null&&r.reserved===null&&r.scheme==='FBO')||(Number.isSafeInteger(r.present)&&Number.isSafeInteger(r.reserved)&&r.present>=0&&r.reserved>=0&&r.present-r.reserved===r.available));}));
  }
  window.OzonDashboard={render:render,tile:tile,ready:function(){return !!snapshot;},asOf:function(){return snapshot&&snapshot.toDate;},core:{validate:validate,totals:totals,setData:function(d){if(!validate(d)) throw new Error('Invalid Ozon snapshot');snapshot=d;}}};
  var url=location.hostname==='aelitaclinic-dev.github.io'?'https://raw.githubusercontent.com/aelitaclinic-dev/letu-dashboard/main/ozon-data.json':'ozon-data.json';
  fetch(url,{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(validate(d)){snapshot=d;window.dispatchEvent(new Event('ozondataready'));}}).catch(function(){/* Preserve explicit unavailable state. */});
}());
