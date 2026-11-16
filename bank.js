/* Bank reconciliation publishes accounting facts only; the PDF and account
   details are never part of this site's files. Founder funding is not revenue. */
(function () {
  'use strict';
  var data=null;
  var labels={'declarations':'Декларации и сертификаты','bank-fees':'Банковские комиссии','taxes':'Налоги и страховые взносы','courier':'Доставка','marking':'Маркировка — Честный знак','unclassified':'Требует уточнения','fines':'Штрафы за отчётность'};
  var states={booked:'Разнесено',classification_assumed:'Предварительно — по пояснению пользователя',needs_classification:'Нужно уточнить назначение',needs_channel:'Нужно уточнить площадку',needs_expense_match:'Связать с декларацией; повторно не добавлено'};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(v){return Number.isSafeInteger(v)?(v/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽':'Нет данных';}
  function day(v){return String(v||'').slice(0,10).split('-').reverse().join('.');}
  function sum(rows){return rows.reduce(function(a,r){return a+r.amountKop;},0);}
  function table(head,rows){return '<div class="ozon-table-wrap"><table class="ozon-table"><thead><tr>'+head.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(v){return '<td>'+esc(v)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';}
  function card(title,value,note){return '<div class="market-empty-metric"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>';}
  function evidence(channel,state){
    if(!data)return null;
    var from=state.from>data.fromDate?state.from:data.fromDate,to=state.to<data.toDate?state.to:data.toDate;
    if(from>to)return null;
    var rows=data.inflows.filter(function(r){return r.kind==='marketplace_payout'&&r.channel===channel&&r.date>=from&&r.date<=to;});
    return {from:from,to:to,amountKop:sum(rows),rows:rows,complete:from===state.from&&to===state.to};
  }
  function bankCard(channel,state){var e=evidence(channel,state);return e?card('Подтверждено банковской выпиской',money(e.amountKop),'Только '+day(e.from)+'–'+day(e.to)+(e.complete?'':' · часть выбранного периода')):card('Подтверждено выпиской банка','Нет выписки','За выбранные даты нет подтверждения');}
  function expensePanel(category){
    if(!data)return '';
    var rows=data.outflows.filter(function(r){return !category||r.category===category;});
    var pending=rows.filter(function(r){return r.state==='needs_expense_match';});
    return '<section class="market-note"><h3>Банк ООО «КЛМ»: '+day(data.fromDate)+'–'+day(data.toDate)+'</h3><p>Списания '+(category?'по этой категории':'по выписке')+': <b>'+money(sum(rows))+'</b>. Это движение денег, а не автоматически признанный расход прибыли. <a href="#bank/ooo">Открыть сверку счёта →</a></p>'
      +(category==='declarations'?'<p><b>Все три декларации по журналу: '+money(sum(data.priorDeclarations||[])+sum(rows))+'.</b> Две прежние — '+money(sum(data.priorDeclarations||[]))+', новая на кератин от 11.11.2026 — '+money(sum(rows))+'. Выписка подтверждает только новый платёж; прежние записи сохранены отдельно.</p>':'')
      +(category==='marking'?'<p>Платежей «Честному знаку» в этой выписке нет. Категория предназначена для оплаты кодов маркировки.</p>':'')+'</section>';
  }
  function render(state){
    var html='<div class="market-heading"><p class="market-eyebrow">ООО «КЛМ» / БАНК</p><h2>Счёт, поступления и расходы</h2><p>Поступления от площадок, взносы учредителя и списания разделены.</p></div>';
    if(!data)return html+'<p>Сверка выписки ещё не загружена.</p>';
    var founders=sum(data.inflows.filter(function(r){return r.kind==='founder_funding';}));
    html+='<p class="ozon-caption">Полная выписка за '+day(data.fromDate)+'–'+day(data.toDate)+'. Банковские реквизиты и исходный документ на сайт не загружены.</p><div class="market-empty-metrics">'
      +card('Остаток на начало',money(data.openingKop),day(data.fromDate))
      +card('Поступило',money(data.incomingKop),'Включая взносы учредителя')
      +card('Списано',money(data.outgoingKop),'Все 11 операций выписки')
      +card('Остаток на конец',money(data.closingKop),day(data.toDate))+'</div>';
    html+='<p>Сверка: '+money(data.openingKop)+' + '+money(data.incomingKop)+' − '+money(data.outgoingKop)+' = '+money(data.closingKop)+'. Остаток сошёлся до копейки.</p>';
    html+='<h3>Поступления на счёт</h3>'+table(['Дата','Источник','Зачислено'],data.inflows.map(function(r){return [day(r.date),r.kind==='founder_funding'?'Взнос учредителя, не выручка':'Wildberries ООО — ООО «РВБ»',money(r.amountKop)];}));
    html+='<p>Взносы учредителя: <b>'+money(founders)+'</b>. В продажи и прибыль они не включены.</p><div class="market-empty-metrics">'+bankCard('ozon-ooo',{from:data.fromDate,to:data.toDate})+bankCard('wb-ooo',{from:data.fromDate,to:data.toDate})+'</div><p><a href="#ozon/ooo/payouts">Выплаты Ozon →</a> · <a href="#wb/ooo/payouts">Выплаты Wildberries ООО →</a></p>';
    html+='<h3>Куда разнесены списания</h3><nav class="market-sections" aria-label="Категории расходов ООО">'+Object.keys(labels).map(function(k){return '<a href="#expenses/'+k+'/ooo">'+esc(labels[k])+'</a>';}).join('')+'</nav>';
    html+=table(['Дата','Платёж','Категория','Сумма','Сверка'],data.outflows.map(function(r){return [day(r.date),r.title,labels[r.category],money(r.amountKop),states[r.state]];}));
    html+='<p class="ozon-caption">Налоги и взносы показаны как оплата обязательств. Период признания и распределение между площадками не выдумываются. Новая декларация на кератин внесена отдельно от двух прежних. Взыскание ФНС на 1 022,35 ₽ указано по решению от 21.09.2026 № 21634, ст. 46 НК РФ. Вид задолженности требует уточнения; к штрафам за отчётность платёж не отнесён.</p>';
    html+='<h3>Декларации прошлых периодов</h3>'+table(['Запись','Месяц в журнале','Сумма','Подтверждение'],(data.priorDeclarations||[]).map(function(r){return [r.title,r.paidMonth,money(r.amountKop),r.note];}))+'<p>Всего по трём декларациям: <b>'+money(sum(data.priorDeclarations||[])+sum(data.outflows.filter(function(r){return r.category==="declarations";})))+'</b>. Эта сумма не прибавляется повторно к списаниям по выписке.</p>';
    html+='<h3>Маркировка</h3><p>'+esc(data.markingNote)+'</p>';
    return html;
  }
  function renderWB(state){var e=evidence('wb-ooo',state);return '<div class="market-heading"><p class="market-eyebrow">WILDBERRIES / ООО «КЛМ»</p><h2>Подтверждённые выплаты</h2><p>Фактические банковские поступления отдельно от отчётов реализации.</p></div><p><a href="#wb/ooo/summary">Сводка Wildberries ООО</a> · <a href="#bank/ooo">Сверка банка ООО</a></p><div class="market-empty-metrics">'+bankCard('wb-ooo',state)+'</div>'+(e?table(['Дата зачисления','Источник','Сумма'],e.rows.map(function(r){return [day(r.date),'ООО «РВБ» / Wildberries',money(r.amountKop)];})):'')+'<p class="ozon-caption">Банковская выписка покрывает 01.08–15.11.2026. Это подтверждение перечислений, не сумма продаж и не чистая прибыль.</p>';}
  function validate(d){
    if(!d||d.schemaVersion!==1||d.owner!=='ooo'||!Array.isArray(d.inflows)||!Array.isArray(d.outflows)||!/^\d{4}-\d{2}-\d{2}$/.test(d.fromDate)||!/^\d{4}-\d{2}-\d{2}$/.test(d.toDate))return false;
    if(![d.openingKop,d.closingKop,d.incomingKop,d.outgoingKop].every(Number.isSafeInteger))return false;
    var ids=new Set(),good=d.inflows.concat(d.outflows).every(function(r){if(!r.id||ids.has(r.id)||!Number.isSafeInteger(r.amountKop)||r.amountKop<=0||r.date<d.fromDate||r.date>d.toDate)return false;ids.add(r.id);return true;});
    return good&&sum(d.inflows)===d.incomingKop&&sum(d.outflows)===d.outgoingKop&&d.openingKop+d.incomingKop-d.outgoingKop===d.closingKop;
  }
  window.BankLedger={render:render,renderWB:renderWB,bankCard:bankCard,evidence:evidence,expensePanel:expensePanel,core:{validate:validate,setData:function(d){if(!validate(d))throw new Error('Invalid bank reconciliation');data=d;}}};
  var url=location.hostname==='aelitaclinic-dev.github.io'?'https://raw.githubusercontent.com/aelitaclinic-dev/letu-dashboard/main/bank-klm.json':'bank-klm.json';
  fetch(url,{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(validate(d)){data=d;window.dispatchEvent(new Event('bankdataready'));}}).catch(function(){/* A missing statement never confirms zero receipts. */});
}());
