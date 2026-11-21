"""Import local executor XLSX reports as aggregate SKU totals, without order identifiers."""
import argparse
import calendar
import csv
import hashlib
import io
import json
import re
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def money(value):
    return int((Decimal(str(value or 0)) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

def extract(path):
    with ZipFile(path) as z:
        strings = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        cells = {}
        for c in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:c', NS):
            v = c.find('s:v', NS)
            if v is not None:
                cells[c.get('r')] = strings[int(v.text)] if c.get('t') == 's' else v.text
        return cells

def report(path):
    cells = extract(path)
    dates = re.findall(r'\d{2}\.\d{2}\.\d{4}', cells['A3'])
    iso = lambda d: '-'.join(reversed(d.split('.')))
    start, end = map(iso, dates)
    month = start[:7]
    rows = []
    for address, name in cells.items():
        if not re.fullmatch(r'B\d+', address):
            continue
        i = address[1:]
        if not cells.get('V'+i, '').strip() or not cells.get('E'+i, '').strip() or not cells.get('Q'+i, '').strip():
            continue
        qty = int(Decimal(cells['Q'+i]))
        brand = 'SINKO STYLING' if name.startswith('SINKO') else "L'OREAL PROFESSIONNEL" if name.startswith("L'OREAL") else 'KERASTASE'
        rows.append(dict(article=cells['E'+i], name=name, brand=brand, qty=qty,
            revenueKop=money(cells['R'+i]), baseKop=money(Decimal(cells['N'+i])*qty),
            commissionKop=money(cells['U'+i]), discountKop=money(cells.get('O'+i)), rate=float(cells['T'+i])))
    assert rows, 'No report rows found'
    def label(text):
        for a,v in cells.items():
            if a.startswith('B') and v.strip()==text:
                return money(cells.get('E'+a[1:]))
        raise ValueError('Missing control: '+text)
    totals = dict(realizationKop=label('Сумма по реализации:'), returnsKop=label('Сумма по возвратам:'),
        commissionGrossKop=label('Сумма комиссионного вознаграждения:'),
        executorDiscountKop=label('Сумма скидки за счет Исполнителя:'),
        commissionKop=label('Сумма комиссионного вознаграждения за минусом скидки за счет Исполнителя:'),
        marketingKop=label('Маркетинговые услуги:'), advancesKop=label('Всего авансов:'),
        payoutKop=label('Всего к оплате:'), compensationKop=label('Сумма возмещения Продавцу:'))
    assert sum(x['revenueKop'] for x in rows)==totals['realizationKop']+totals['returnsKop']
    assert sum(x['commissionKop'] for x in rows)==totals['commissionGrossKop']
    assert sum(x['discountKop'] for x in rows)==totals['executorDiscountKop']
    assert totals['commissionGrossKop']-totals['executorDiscountKop']==totals['commissionKop']
    assert totals['realizationKop']+totals['returnsKop']-totals['commissionKop']-totals['marketingKop']-totals['advancesKop']+totals['compensationKop']==totals['payoutKop']
    products, commissions = {}, {}
    for r in rows:
        key = r['article']
        p = products.setdefault(key, dict(article=key, name=r['name'], brand=r['brand'], saleQty=0, returnQty=0, revenueKop=0, commissionKop=0))
        p['saleQty']+=max(r['qty'],0); p['returnQty']+=max(-r['qty'],0)
        p['revenueKop']+=r['revenueKop']; p['commissionKop']+=r['commissionKop']-r['discountKop']
        c = commissions.setdefault((key,r['rate']),dict(article=key,name=r['name'],rate=r['rate'],rateLabel=f"{r['rate']*100:g}%",qty=0,baseKop=0,commissionKop=0,discountKop=0,withheldKop=0))
        c['qty']+=r['qty']
        for k in ['baseKop','commissionKop','discountKop']: c[k]+=r[k]
        c['withheldKop']+=r['commissionKop']-r['discountKop']
    last=calendar.monthrange(int(month[:4]),int(month[5:]))[1]
    return dict(month=month,from_=start,to=end,partial=end[-2:]!=str(last),title=cells['A2'],
        source=f"{cells['A2']} · {cells['A3']}",sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        totals=totals,products=list(products.values()),commissionRows=list(commissions.values()))

def update(data_path, reports, analytics_path):
    text=data_path.read_text()
    d=json.loads(re.sub(r';\s*$','',re.sub(r'^window\.DASHBOARD\s*=\s*','',text)))
    old = d.get('letuFinance', {})
    parsed=[]
    for p in reports:
        r=report(p);r['from']=r.pop('from_');parsed.append(r)
    d['letuFinance'] = dict(schemaVersion=1,updatedOn='2026-11-21',
        costPolicy=dict(productLabelKop=600,deliveryPerTripKop=300000,
            excluded=['box','boxLabel','packer','film','otherMaterials'],
            note='Условия поставки Л’Этуаль уточнены пользователем 21.11.2026; прежние месяцы и другие площадки не пересчитаны.'),
        deliveries=old.get('deliveries',{'2026-10':dict(count=1,dates=['2026-10-01'],requestDate='2026-09-29',acceptedWithDiscrepancies=True,status='Поставка подтверждена пользователем, цена доставки оценочная',
            source='Пользователь 21.11.2026: одна поставка принята 01.10.2026 с разногласиями.',countConfirmed=True),
            '2026-11':dict(count=None,dates=[],status='Количество поставок не подтверждено')}),reports=parsed)
    if analytics_path:
        text=analytics_path.read_text()
        segment=text.split('TAB NAME: Остатки и поставка>',1)[1].split('<PARSED TEXT FOR SHEET: 2',1)[0]
        # Quoted names may contain newlines. The CSV parser preserves the source rows.
        lines=[]
        for r in csv.reader(io.StringIO(segment)):
            if len(r)<23 or not r[0].isdigit() or not r[1].startswith('MPL'):continue
            ordered=int(r[10] or 0);delivered=int(r[8] or 0)
            if ordered or delivered:
                lines.append(dict(article=r[2],brand=r[3],name=r[4],warehouse='Все склады (сводная выгрузка)',
                    orderedQty=ordered,orderedKop=money(r[14]),deliveredQty=delivered,deliveredKop=money(r[13])))
        octrow=next(r for r in d['months'] if r['month']=='2026-10')
        assert sum(r['orderedQty'] for r in lines)==26
        assert sum(r['orderedKop'] for r in lines)==7131000
        assert sum(r['deliveredQty'] for r in lines)==17
        assert sum(r['deliveredKop'] for r in lines)==4196500
        octrow.update(movementState='month',orderedQty=26,orderedKop=7131000,deliveredQty=17,deliveredKop=4196500,
            analyticsStart='2026-10-01',analyticsEnd='2026-10-31',lines=lines,
            analyticsSource='Аналитика Л’Этуаль 01–31.10.2026, сводная таблица от 10.11.2026')
    for report_data in parsed:
        t=report_data['totals'];m=next(r for r in d['months'] if r['month']==report_data['month'])
        m.update(financeState='partial' if report_data['partial'] else 'month',
            realizationKop=t['realizationKop'],returnsKop=t['returnsKop'],commissionAfterKop=t['commissionKop'],
            advancesKop=t['advancesKop'],marketingKop=t['marketingKop'],payoutKop=t['payoutKop'],
            financeStart=report_data['from'],financeEnd=report_data['to'])
        if m['movementState']=='future':m['movementState']='missing'
        brands={}
        for p in report_data['products']:
            b=brands.setdefault(p['brand'],dict(brand=p['brand'],commissionKop=0,rates=[]));b['commissionKop']+=p['commissionKop']
            b['rates']=sorted({int(c['rate']*100) for c in report_data['commissionRows'] if c['article']==p['article']}|set(b['rates']))
        m['lineBrands']=list(brands.values())
        for g in d['unitEconomics']['groups']:
            for i in g['items']:
                observations=[c for c in report_data['commissionRows'] if c['article']==i['article']]
                rates=sorted({c['rate'] for c in observations})
                if len(rates)==1:
                    i.update(commissionRate=rates[0],commissionRateSource='sku',commissionRateStatus='наблюдаемая',
                        commissionObservedTo=report_data['to'],commissionRateNote=f"Подтверждено {report_data['title']}. Фактическая ставка строки {rates[0]*100:g}%. Удержание в прибыли равно вознаграждению минус скидка исполнителя.")
    receipt = dict(id='letu-delivery-2026-10',entity='ip',payerEntity='ip',beneficiaryEntity='ip',date=d['letuFinance']['deliveries']['2026-10']['dates'][0],
        paidMonth='2026-10',category='courier',title='Доставка партии на склад Л’Этуаль — октябрь',
        amountKop=d['letuFinance']['deliveries']['2026-10']['count']*300000,currency='RUB',channelScope='letu',status='estimate',
        allocationMethod='month',methodConfirmed=True,order=167,local=False,
        comment='Одна поставка по заявке 29.09.2026 принята 01.10.2026 с разногласиями; подтверждено пользователем 21.11.2026. Доставка оценочно 3 000 ₽ за рейс, оплата не подтверждена.',
        document='Пояснение пользователя 21.11.2026',paymentConfirmedByUser=False,needs=[])
    records=d['businessExpenses']['records'];records[:]=[r for r in records if r['id']!=receipt['id']];records.append(receipt)
    d['profit']['registers']['trips']=[dict(date=d['letuFinance']['deliveries']['2026-10']['dates'][0],site='Л’Этуаль',courierKop=300000,
        fuelKop=None,otherKop=None,totalKop=300000,status='estimate',source='Пояснение пользователя: заявка 29.09, приёмка 01.10 с разногласиями. Доставка оценочная.')]
    for k,key in [('orderedQty','orderedQty'),('orderedKop','orderedKop'),('deliveredQty','deliveredQty'),('deliveredKop','deliveredKop')]:
        d['span'][k]=sum(r[key] for r in d['months'] if r['movementState'] in ['month','partial'])
    d['span']['end']='2026-10-31'
    d.update(asOf='2026-11-15',asOfLabel='15 ноября 2026',preparedOn='2026-11-21',preparedLabel='21 ноября 2026',
        freshness='Обновлено 21 ноября 2026. Аналитика заказов и доставок Л’Этуаль загружена по 31 октября 2026. Финансовый отчёт за октябрь полный, за ноябрь — 1–15 ноября. Это загрузка отчётов, не автоматический сбор. Даты остатков и банковских поступлений показаны отдельно. Для Л’Этуаль с октября учтены одна наклейка, себестоимость, фактическая комиссия, расчётный налог и известные доставки. Декларации и неизвестные расходы не заменены нулём.')
    d['profit']['coverage'].update(salesThrough='2026-10-31',financeFullThrough='2026-10-31',financeThrough='2026-11-15',todayIsNotCoverage='2026-11-21')
    data_path.write_text('window.DASHBOARD = '+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n')
    return parsed

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,default=Path('data.js'))
    p.add_argument('--analytics-text',type=Path);p.add_argument('reports',nargs='+',type=Path)
    args=p.parse_args()
    for r in update(args.data,args.reports,args.analytics_text):print(r['month'],r['totals'])
