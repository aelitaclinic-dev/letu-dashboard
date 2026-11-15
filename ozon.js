/* Ozon aggregates only. This browser never receives marketplace credentials. */
(function () {
  'use strict';
  var snapshot = null;
  var months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(v) { return Number.isSafeInteger(v) ? (v/100).toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₽' : 'Нет данных'; }
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
  function totals(state) {
    var rows=selected(state), sold=total(rows,'sales','salesKop'), returned=total(rows,'sales','returnsKop');
    return {rows:rows,sold:sold,returned:returned,net:sold.value==null||returned.value==null?null:sold.value-returned.value,
      salesQty:total(rows,'sales','salesQty'), returnsQty:total(rows,'sales','returnsQty'), paid:total(rows,'balance','paidKop'), accrued:total(rows,'balance','accruedKop')};
  }
  function coverage(metric, rows) { return metric.complete ? 'Полный выбранный период' : 'Только доступные отчёты: '+metric.count+' из '+rows.length+' мес.'; }
  function periodForm(state) { return '<form class="market-period" id="period-filter"><div class="period-caption">Период отчётов</div><label>С даты<input type="date" name="from" required value="'+esc(state.from)+'"></label><label>По дату<input type="date" name="to" required value="'+esc(state.to)+'"></label><button type="submit">Применить</button></form>'; }
  function summary(state) {
    var t=totals(state), s=snapshot.stocks, stock=ready(s)?s.rows.reduce(function(a,r){return a+r.available;},0):null;
    var html='<div class="market-empty-metrics">'+card('Продажи после возвратов',money(t.net),coverage(t.sold,t.rows))
      +card('Продано / возвращено',t.salesQty.value==null?'Нет данных':t.salesQty.value+' / '+t.returnsQty.value+' шт.','По отчётам реализации, без отмен')
      +card('Перечислено по данным Ozon',money(t.paid.value),coverage(t.paid,t.rows))
      +card('Доступно к продаже сейчас',stock==null?'Нет данных':stock+' шт.','Снимок остатков; не зависит от периода')+'</div>';
    html+='<h3>Продажи и выплаты по месяцам · '+snapshot.year+'</h3><p class="ozon-caption">Продажи — по цене продавца с учётом скидок, до расходов. Начисления и выплаты — отдельные показатели.</p>';
    html+=table(['Месяц','Продано, шт.','Продажи','Возвращено, шт.','Возвраты','После возвратов','Начислено на баланс','Перечислено Ozon','Полнота'],snapshot.months.map(function(m){
      if(m.state==='future') return [label(m),'—','—','—','—','—','—','—','Период не наступил'];
      var a=m.sales,b=m.balance, ok=ready(a), bk=ready(b);
      return [label(m)+(m.partial?' · по '+day(m.toDate):''),ok?a.salesQty:'—',ok?money(a.salesKop):'Нет отчёта',ok?a.returnsQty:'—',ok?money(a.returnsKop):'Нет отчёта',ok?money(a.salesKop-a.returnsKop):'Нет отчёта',bk?money(b.accruedKop):'Нет данных',bk?money(b.paidKop):'Нет данных',m.partial?'Месяц не закрыт':ok&&bk&&b.paymentReconciled?'Отчёты получены':'Есть пробелы'];
    }));
    html+='<p class="ozon-caption">Таблица показывает весь год. Карточки выше учитывают только отчётные месяцы, целиком попавшие в выбранные даты. Незагруженные месяцы не считаются нулевыми.</p>';
    return html;
  }
  function payouts(state) {
    var t=totals(state);
    var html='<div class="market-empty-metrics">'+card('Начислено на баланс',money(t.accrued.value),coverage(t.accrued,t.rows))+card('Перечислено Ozon',money(t.paid.value),coverage(t.paid,t.rows))+card('Подтверждено выпиской банка','Не сверено','Нужна банковская выписка за выбранный период')+'</div>';
    html+='<p>«Перечислено Ozon» — сумма выплат в отчёте площадки. Фактическое зачисление в банк подтверждается отдельно. Выплаты не являются прибылью и могут относиться к продажам другого месяца.</p>';
    html+=table(['Период','Баланс на начало','Начислено','Перечислено','Баланс на конец','Проверка'],t.rows.map(function(m){var b=m.balance;return ready(b)?[day(m.fromDate)+'–'+day(m.toDate),money(b.openingKop),money(b.accruedKop),money(b.paidKop),money(b.closingKop),b.paymentReconciled?'Балансовое равенство выполнено':'Выплаты требуют сверки']:[label(m),'—','—','—','—','Нет отчёта'];}));
    html+='<p class="ozon-caption">Сверка: начальный баланс + начисления − выплаты = конечный баланс. Если равенство не выполняется до копейки, сумма выплат не подменяется расчётной.</p>';
    var cf=snapshot.cashflow;
    if(ready(cf)) html+='<h3>Контрольные отчёты выплат Ozon</h3><p>Периоды, за которые доступен финансовый отчёт. Указан отчётный период, а не дата банковского перевода.</p>'+table(['С периода','По период','Выплаты в исходном отчёте','Начальный баланс','Конечный баланс'],cf.details.filter(function(r){return r.fromDate>=state.from&&r.toDate<=state.to;}).map(function(r){return [day(r.fromDate),day(r.toDate),money(r.reportedPaymentsKop),money(r.openingKop),money(r.closingKop)];}));
    return html;
  }
  function stock() {
    var s=snapshot.stocks;
    if(!ready(s)) return '<p>Остатки не получены. Нет данных не означает нулевой склад.</p>';
    var html='<p>Текущий снимок: '+esc(s.asOf.replace('T',' ').slice(0,19))+' МСК. Исторические остатки на конец предыдущих месяцев API-выгрузкой не восстановлены.</p>';
    html+='<div class="market-empty-metrics">'+card('В наличии FBS/rFBS',s.rows.reduce(function(a,r){return a+(r.present||0);},0)+' шт.','Только FBS/rFBS; наличие FBO здесь не прибавлено')+card('Зарезервировано FBS/rFBS',s.rows.reduce(function(a,r){return a+(r.reserved||0);},0)+' шт.','Резерв FBO не получен')+card('Доступно к продаже',s.rows.reduce(function(a,r){return a+r.available;},0)+' шт.','Доступность по API FBS/rFBS и FBO')+'</div>';
    html+=table(['Артикул продавца','Товар','Схема','Склад','В наличии','Резерв','Доступно'],s.rows.map(function(r){return [r.article,r.name,r.scheme,r.warehouse,r.present==null?'Не передаётся':r.present,r.reserved==null?'Не передаётся':r.reserved,r.available];}));
    if(s.warehouseDetailState!=='ready') html+='<p class="ozon-caption">Разбивка по отдельным складам получена не полностью. Итоги по схемам не суммируются повторно с детализацией.</p>';
    if(s.fboState && s.fboState!=='ready') html+='<p class="ozon-caption">Остатки FBO не получены; они не включены в итог.</p>';
    return html;
  }
  function products(state) {
    var items={};
    selected(state).forEach(function(m){if(!ready(m.sales))return;m.sales.products.forEach(function(p){var r=items[p.article]||(items[p.article]={article:p.article,name:p.name,salesQty:0,returnsQty:0,salesKop:0,returnsKop:0});['salesQty','returnsQty','salesKop','returnsKop'].forEach(function(k){r[k]+=p[k];});});});
    return '<p>Реализация по артикулам за полученные полные отчётные месяцы. Себестоимость и чистая прибыль в эти суммы не входят.</p>'+table(['Артикул','Товар','Продано','Возвращено','Продажи','Возвраты','После возвратов'],Object.keys(items).sort().map(function(k){var p=items[k];return [p.article,p.name,p.salesQty,p.returnsQty,money(p.salesKop),money(p.returnsKop),money(p.salesKop-p.returnsKop)];}));
  }
  function sources() {
    return '<details class="fold ozon-sources"><summary>Источники и точность цифр</summary><p>Продажи и возвраты: месячные отчёты реализации Ozon, цена продавца × количество. Отмены и невыкупы в продажи не добавляются. Начисления и перечисления: отчёт баланса Ozon. Финансовый отчёт выплат показан отдельно для контроля и не прибавляется повторно.</p><p>Остатки: текущий снимок API. Дата обновления указана на вкладке. Пустой или недоступный отчёт не заменяется нулём. Ноябрьский отчёт реализации появится после закрытия месяца.</p><p>Комиссии, логистика, налоги и себестоимость не вычитаются из показателя продаж. Для чистой прибыли нужны себестоимость по партиям и подтверждённые расходы ООО. Банковская выписка ещё не сверена.</p></details>';
  }
  function render(section, state, store) {
    var active=['summary','unit','profit','payouts','stock'].indexOf(section)>=0?section:'summary';
    var tabs=[['summary','Сводка'],['unit','Товары'],['payouts','Выплаты'],['stock','Остатки'],['profit','Прибыль и расходы']];
    var html='<div class="market-heading"><p class="market-eyebrow">OZON / ООО «КЛМ»</p><h2>Продажи, склад и деньги</h2><p>Раздельный учёт реализации, начислений и перечислений.</p></div><div class="market-store-bar"><nav class="store-switch" aria-label="Магазины Ozon">'+[['all','Все магазины'],['ip','ИП'],['ooo','ООО «КЛМ»']].map(function(r){return '<a href="#ozon/'+r[0]+'/'+active+'"'+(store===r[0]?' class="selected" aria-current="page"':'')+'>'+r[1]+'</a>';}).join('')+'</nav><span class="market-status '+(snapshot?'connected':'pending')+'">'+(snapshot?'ООО: отчёты получены':'ООО: данные ещё не опубликованы')+'</span></div>';
    html+=periodForm(state)+'<nav class="market-sections" aria-label="Разделы Ozon">'+tabs.map(function(r){return '<a href="#ozon/'+store+'/'+r[0]+'"'+(active===r[0]?' class="selected" aria-current="page"':'')+'>'+r[1]+'</a>';}).join('')+'</nav>';
    if(store==='ip') return html+'<section class="market-empty-state"><h3>Ozon ИП ещё не подключён</h3><p>Данные ООО «КЛМ» доступны отдельно.</p></section>';
    if(store==='all') html+='<p class="ozon-caption">Показаны только данные ООО «КЛМ». Кабинет ИП пока не включён в общий итог.</p>';
    if(!snapshot) return html+'<section class="market-empty-state"><div><h3>Загрузка отчётов подготовлена</h3><p>Сводные цифры пока не опубликованы. Отсутствующие значения не считаются нулевыми продажами или выплатами.</p></div></section>';
    html+='<p class="ozon-caption">Обновлено '+esc(snapshot.generatedAt.replace('T',' ').slice(0,19))+' МСК · '+day(snapshot.fromDate)+'–'+day(snapshot.toDate)+'</p>';
    if(active==='summary') html+=summary(state);
    else if(active==='payouts') html+=payouts(state);
    else if(active==='stock') html+=stock();
    else if(active==='unit') html+=products(state);
    else html+='<h3>Начисления и выплаты не равны чистой прибыли</h3><p>Для расчёта прибыли ООО нужны себестоимость по партиям, налоги и расходы. Продажи и перечисления доступны в сводке и выплатах; отсутствующие затраты не приняты за ноль.</p><a class="button secondary" href="#expenses">Расходы ИП / ООО</a>';
    return html+sources();
  }
  function tile(state) {
    var t=totals(state);
    return '<a class="market-tile market-ozon" href="#ozon/ooo/summary"><div class="market-tile-top"><span class="market-symbol">O</span><span class="market-status '+(snapshot?'connected':'pending')+'">'+(snapshot?'ООО: отчёты получены':'Подготовлено подключение')+'</span></div><h3>Ozon</h3><p class="market-store-caption">ООО «КЛМ» · ИП пока не подключён</p><div class="market-sales"><span>Продажи после возвратов</span><strong>'+esc(money(t.net))+'</strong><small>'+esc(snapshot?coverage(t.sold,t.rows):'Сводные цифры ещё не опубликованы')+'</small></div><dl class="market-tile-details"><div><dt>Перечислено Ozon</dt><dd>'+esc(money(t.paid.value))+'</dd></div><div><dt>Чистая прибыль</dt><dd>Не рассчитана</dd></div></dl><p class="market-data-note">Отчёты реализации, баланс и текущие остатки — в отдельных разделах.</p><span class="market-open">Открыть ООО «КЛМ» ↗</span></a>';
  }
  function validate(data) {
    if(!data || data.schemaVersion!==1 || data.owner!=='ooo' || !Number.isInteger(data.year) || !Array.isArray(data.months) || data.months.length!==12 || typeof data.generatedAt!=='string') return false;
    return data.months.every(function(m){if(m.state==='future') return /^\d{4}-\d{2}$/.test(m.month);var s=m.sales,b=m.balance;return /^\d{4}-\d{2}$/.test(m.month)&&typeof m.fromDate==='string'&&typeof m.toDate==='string'&&s&&b&&(!ready(s)||(['salesQty','returnsQty','salesKop','returnsKop','reportAccruedKop'].every(function(k){return Number.isSafeInteger(s[k]);})&&Array.isArray(s.products)))&&(!ready(b)||(['openingKop','closingKop','accruedKop','reportedPaymentsKop'].every(function(k){return Number.isSafeInteger(b[k]);})&&(b.paidKop===null||Number.isSafeInteger(b.paidKop))));}) && data.stocks && (!ready(data.stocks)||Array.isArray(data.stocks.rows)&&data.stocks.rows.every(function(r){return typeof r.article==='string'&&Number.isSafeInteger(r.available)&&r.available>=0&&((r.present===null&&r.reserved===null&&r.scheme==='FBO')||(Number.isSafeInteger(r.present)&&Number.isSafeInteger(r.reserved)&&r.present>=0&&r.reserved>=0&&r.present-r.reserved===r.available));}));
  }
  window.OzonDashboard={render:render,tile:tile,ready:function(){return !!snapshot;},asOf:function(){return snapshot&&snapshot.toDate;},core:{validate:validate,totals:totals,setData:function(d){if(!validate(d)) throw new Error('Invalid Ozon snapshot');snapshot=d;}}};
  var url=location.hostname==='aelitaclinic-dev.github.io'?'https://raw.githubusercontent.com/aelitaclinic-dev/letu-dashboard/main/ozon-data.json':'ozon-data.json';
  fetch(url,{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(validate(d)){snapshot=d;window.dispatchEvent(new Event('ozondataready'));}}).catch(function(){/* Preserve explicit unavailable state. */});
}());
