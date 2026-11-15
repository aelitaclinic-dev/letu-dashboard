"""Read Ozon accounting reports. Only --publish writes allowlisted aggregates.

The existing Pages site and repository are public. Without explicit publication
approval this script only validates data in memory and reports source statuses.
No credentials, raw reports, order IDs, bank details or amounts are logged.
"""
import argparse
import calendar
import datetime as dt
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

MSK = dt.timezone(dt.timedelta(hours=3))
ROOT = Path(__file__).resolve().parents[1]


class SyncError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class Client:
    def __init__(self):
        self.client_id = os.environ.get('OZON_OOO_CLIENT_ID', '').strip()
        self.key = os.environ.get('OZON_OOO_API_KEY', '').strip()
        self.opener = urllib.request.build_opener(NoRedirect())
        if not self.client_id.isascii() or not self.client_id.isdigit() or not self.key:
            raise SyncError('Missing or invalid Ozon credentials')

    def post(self, endpoint, body):
        for attempt in range(4):
            request = urllib.request.Request('https://api-seller.ozon.ru' + endpoint,
                data=json.dumps(body).encode(), method='POST', headers={
                    'Client-Id': self.client_id, 'Api-Key': self.key,
                    'Content-Type': 'application/json'})
            try:
                with self.opener.open(request, timeout=35) as response:
                    payload = response.read(40_000_001)
                if len(payload) > 40_000_000:
                    raise SyncError('Ozon response exceeds supported size')
                data = json.loads(payload, parse_float=Decimal)
                if not isinstance(data, dict):
                    raise SyncError('Unexpected Ozon response format')
                return data
            except urllib.error.HTTPError as error:
                if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(min(30, 3 * 2 ** attempt))
                    continue
                raise SyncError(endpoint + ': HTTP ' + str(error.code)) from None
            except (OSError, ValueError):
                if attempt < 3:
                    time.sleep(2)
                    continue
                raise SyncError(endpoint + ': network or JSON error') from None
        raise SyncError('Ozon request did not complete')


def kop(value):
    if value is None or isinstance(value, bool):
        raise SyncError('Missing monetary field')
    try:
        scaled = Decimal(str(value)) * 100
    except InvalidOperation:
        raise SyncError('Invalid monetary field') from None
    if not scaled.is_finite() or scaled != scaled.to_integral_value() or abs(scaled) > 9_007_199_254_740_991:
        raise SyncError('Unsupported monetary precision')
    return int(scaled)


def rub_money(value, field='value'):
    if not isinstance(value, dict) or value.get('currency_code') not in ('RUB', 'RUR'):
        raise SyncError('Missing money or unsupported currency')
    return kop(value.get(field))


def quantity(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise SyncError('Invalid quantity')
    return value


def bounds(year, month):
    return dt.date(year, month, 1), dt.date(year, month, calendar.monthrange(year, month)[1])


def normalized_name(value):
    return re.sub(r'[\s«»„“”".,]+', '', str(value).upper())


def verify_seller(client):
    company = client.post('/v1/seller/info', {}).get('company', {})
    names = [company.get('legal_name', ''), company.get('name', ''),
             str(company.get('ownership_form', '')) + str(company.get('name', ''))]
    expected = {'КЛМ', 'ОООКЛМ', 'ОБЩЕСТВОСОГРАНИЧЕННОЙОТВЕТСТВЕННОСТЬЮКЛМ'}
    if not any(normalized_name(name) in expected for name in names):
        raise SyncError('Seller identity does not match KLM')
    if company.get('currency') not in ('RUB', 'RUR'):
        raise SyncError('Seller currency is not RUB')


def realization(data, year, month):
    result = data.get('result')
    if not isinstance(result, dict) or not isinstance(result.get('rows'), list):
        raise SyncError('Invalid realization report')
    header = result.get('header', {})
    start, end = bounds(year, month)
    if (str(header.get('start_date', ''))[:10] != start.isoformat()
            or str(header.get('stop_date', ''))[:10] != end.isoformat()
            or header.get('currency_sys_name') not in ('RUB', 'RUR')):
        raise SyncError('Realization report period or currency mismatch')
    totals = dict(salesQty=0, returnsQty=0, salesKop=0, returnsKop=0, reportAccruedKop=0)
    products = {}
    seen = set()
    for row in result['rows']:
        row_id = row.get('rowNumber', row.get('row_number'))
        if row_id is None or row_id in seen:
            raise SyncError('Missing or duplicate realization row')
        seen.add(row_id)
        item = row.get('item', {})
        article = str(item.get('offer_id', '')).strip()
        if not article:
            raise SyncError('Missing seller article')
        product = products.setdefault(article, dict(article=article,
            name=str(item.get('name', ''))[:350], salesQty=0, returnsQty=0, salesKop=0, returnsKop=0))
        price = kop(row.get('seller_price_per_instance'))
        if price < 0:
            raise SyncError('Negative seller unit price')
        for source, prefix, sign in [('delivery_commission', 'sales', 1), ('return_commission', 'returns', -1)]:
            block = row.get(source)
            if block is None:
                continue
            q = quantity(block.get('quantity'))
            # seller_price_per_instance is a UNIT price; block.amount and
            # block.total have different meanings and are never multiplied.
            amount = price * q
            totals[prefix + 'Qty'] += q
            totals[prefix + 'Kop'] += amount
            product[prefix + 'Qty'] += q
            product[prefix + 'Kop'] += amount
            totals['reportAccruedKop'] += sign * kop(block.get('total'))
    return dict(state='ready', basis='seller_price_per_instance*quantity',
                fromDate=start.isoformat(), toDate=end.isoformat(),
                **totals, products=sorted(products.values(), key=lambda r: r['article']))


def balance(data):
    total = data.get('total')
    if not isinstance(total, dict) or not isinstance(total.get('payments'), list):
        raise SyncError('Invalid balance report')
    opening = rub_money(total.get('opening_balance'))
    closing = rub_money(total.get('closing_balance'))
    accrued = rub_money(total.get('accrued'))
    payments = sum(rub_money(row) for row in total['payments'])
    outgoing = opening + accrued - closing
    # Do not guess whether the API uses debit or credit signs. Require the
    # reported payments to reconcile with the balance equation to the kopeck.
    if outgoing == payments:
        paid, convention = payments, 'outgoing_positive'
    elif outgoing == -payments:
        paid, convention = -payments, 'outgoing_negative'
    else:
        paid, convention = None, 'unreconciled'
    return dict(state='ready', openingKop=opening, closingKop=closing,
        accruedKop=accrued, reportedPaymentsKop=payments, paidKop=paid,
        paymentConvention=convention, paymentReconciled=paid is not None)


def cashflow_rows(client, start, end):
    rows, details, seen = [], [], set()
    for page in range(1, 101):
        data = client.post('/v1/finance/cash-flow-statement/list', {
            'date': {'from': start + 'T00:00:00+03:00', 'to': end + 'T23:59:59+03:00'},
            'page': page, 'page_size': 100, 'with_details': True}).get('result', {})
        count = data.get('page_count')
        if not isinstance(count, int) or count < 0 or not isinstance(data.get('cash_flows'), list):
            raise SyncError('Invalid cash-flow pagination')
        for row in data['cash_flows']:
            period = row.get('period', {})
            key = period.get('id')
            if key in seen or key is None:
                raise SyncError('Duplicate cash-flow period')
            seen.add(key)
            if row.get('currency_code') not in ('RUB', 'RUR'):
                raise SyncError('Unsupported cash-flow currency')
            begin, stop = str(period.get('begin', ''))[:10], str(period.get('end', ''))[:10]
            if not start <= begin <= stop <= end:
                raise SyncError('Cash-flow period outside requested year')
            rows.append(dict(fromDate=begin, toDate=stop,
                ordersKop=kop(row.get('orders_amount')), returnsKop=kop(row.get('returns_amount')),
                commissionKop=kop(row.get('commission_amount')), servicesKop=kop(row.get('services_amount')),
                logisticsKop=kop(row.get('item_delivery_and_return_amount'))))
        if not isinstance(data.get('details'), list):
            raise SyncError('Missing cash-flow details')
        for row in data['details']:
            period = row.get('period', {})
            begin, stop = str(period.get('begin', ''))[:10], str(period.get('end', ''))[:10]
            if not start <= begin <= stop <= end or not isinstance(row.get('payments'), list):
                raise SyncError('Invalid cash-flow detail period')
            payments = sum(rub_money(p, 'payment') for p in row['payments'])
            details.append(dict(fromDate=begin, toDate=stop, reportedPaymentsKop=payments,
                openingKop=kop(row.get('begin_balance_amount')), closingKop=kop(row.get('end_balance_amount'))))
        if page >= max(1, count):
            if len({(r['fromDate'], r['toDate']) for r in details}) != len(details):
                raise SyncError('Duplicate cash-flow detail')
            return dict(state='ready', periods=sorted(rows, key=lambda r:r['fromDate']),
                        details=sorted(details, key=lambda r:r['fromDate']))
    raise SyncError('Cash-flow pagination exceeds limit')


def catalog(client):
    products = {}
    for visibility in ('ALL', 'ARCHIVED'):
        cursor, seen = '', set()
        for page in range(100):
            result = client.post('/v3/product/list', dict(filter=dict(visibility=visibility), last_id=cursor, limit=1000)).get('result', {})
            batch = result.get('items')
            if not isinstance(batch, list):
                raise SyncError('Invalid catalog page')
            for row in batch:
                products[row['product_id']] = row
            total = result.get('total_items', result.get('total'))
            cursor = result.get('last_id', '')
            if len(batch) < 1000 or not cursor:
                if isinstance(total, int) and page == 0 and len(batch) != total:
                    raise SyncError('Incomplete catalog page')
                break
            if cursor in seen:
                raise SyncError('Catalog cursor repeated')
            seen.add(cursor)
        else:
            raise SyncError('Catalog pagination exceeds limit')
    result = {}
    ids = list(products)
    for offset in range(0, len(ids), 1000):
        batch = client.post('/v3/product/info/list', {'product_id': ids[offset:offset+1000]}).get('items')
        if not isinstance(batch, list):
            raise SyncError('Invalid product metadata')
        for row in batch:
            article = str(row.get('offer_id', '')).strip()
            if not article:
                raise SyncError('Missing stock article')
            result[row['id']] = dict(article=article, name=str(row.get('name', ''))[:350],
                archived=bool(row.get('is_archived')), skus=list({s.get('sku') for s in row.get('sources', []) if s.get('sku')} | ({row['sku']} if row.get('sku') else set())))
    if set(ids) != set(result):
        raise SyncError('Product metadata coverage mismatch')
    return result


def stocks(client, products):
    rows, seen, cursor = [], set(), ''
    names = {p['article']:p['name'] for p in products.values()}
    skus = sorted({sku for p in products.values() for sku in p['skus']})
    for page in range(100):
        data = client.post('/v2/product/info/stocks-by-warehouse/fbs',
                           {'limit':1000, 'cursor':cursor})
        if not isinstance(data.get('products'),list) or not isinstance(data.get('has_next'),bool):
            raise SyncError('Invalid FBS warehouse stock page')
        for item in data['products']:
            article = str(item.get('offer_id',''))
            identity = (item.get('product_id'),item.get('warehouse_id'),item.get('sku'))
            if identity in seen or article not in names:
                raise SyncError('Duplicate or unidentified FBS warehouse stock')
            seen.add(identity)
            present = quantity(item.get('present'))
            reserved = quantity(item.get('reserved'))
            free = quantity(item.get('free_stock'))
            if present-reserved != free:
                raise SyncError('FBS available stock does not reconcile')
            rows.append(dict(article=article,name=names[article],scheme='FBS/rFBS',
                warehouse=str(item.get('warehouse_name') or 'Склад продавца')[:160],
                present=present,reserved=reserved,available=free,source='stocks-by-warehouse/fbs'))
        if not data['has_next']:
            break
        next_cursor = data.get('cursor')
        if not next_cursor or next_cursor == cursor:
            raise SyncError('FBS stock cursor repeated or missing')
        cursor = next_cursor
    else:
        raise SyncError('FBS warehouse pagination exceeds limit')
    fbo_state, fbo_error, fbo_rows, fbo_seen = 'ready', None, [], set()
    try:
        for offset in range(0,len(skus),100):
            time.sleep(3)
            data = client.post('/v1/analytics/stocks', {'skus':skus[offset:offset+100]})
            if not isinstance(data.get('items'),list):
                raise SyncError('Invalid FBO stock response')
            for item in data['items']:
                article = str(item.get('offer_id',''))
                identity = (item.get('sku'),item.get('warehouse_id'))
                if identity in fbo_seen or article not in names:
                    raise SyncError('Duplicate or unidentified FBO stock')
                fbo_seen.add(identity)
                # FBO API exposes availability but no equivalent FBS reservation
                # counter. Unknown presence/reserve must remain null, never zero.
                fbo_rows.append(dict(article=article,name=names[article],scheme='FBO',
                    warehouse=str(item.get('warehouse_name') or 'Склад Ozon')[:160],
                    present=None,reserved=None,available=quantity(item.get('available_stock_count')),
                    source='analytics/stocks'))
    except SyncError as error:
        fbo_state, fbo_error = 'unavailable', str(error)
        fbo_rows = []
    return dict(state='ready', scope='FBS/rFBS and FBO' if fbo_state=='ready' else 'FBS/rFBS only',
        rows=sorted(rows+fbo_rows,key=lambda r:(r['article'],r['scheme'],r['warehouse'])),
        fboState=fbo_state,fboError=fbo_error,historicalState='not_available',warehouseDetailState='ready')


def unavailable(error):
    return dict(state='unavailable', error=str(error))


def collect(client, year, today):
    verify_seller(client)
    snapshot = dict(schemaVersion=1, owner='ooo', seller='ООО «КЛМ»', year=year,
        generatedAt=dt.datetime.now(MSK).isoformat(timespec='seconds'),
        fromDate=f'{year}-01-01', toDate=min(today, dt.date(year,12,31)).isoformat(),
        bankConfirmation='not_provided', months=[])
    for month in range(1, 13):
        start, end = bounds(year, month)
        if start > today:
            snapshot['months'].append(dict(month=f'{year}-{month:02}', state='future'))
            continue
        row = dict(month=f'{year}-{month:02}', fromDate=start.isoformat(), toDate=min(end,today).isoformat(),
                   partial=end>today)
        try:
            row['sales'] = realization(client.post('/v2/finance/realization', {'year':year, 'month':month}), year, month)
        except SyncError as error:
            row['sales'] = unavailable(error)
        try:
            row['balance'] = balance(client.post('/v1/finance/balance', {'date_from': row['fromDate'], 'date_to': row['toDate']}))
        except SyncError as error:
            row['balance'] = unavailable(error)
        row['state'] = 'ready' if row['sales']['state']=='ready' and row['balance']['state']=='ready' else 'partial'
        snapshot['months'].append(row)
        print(row['month'] + ': sales=' + row['sales']['state'] + '; balance=' + row['balance']['state']
              + '; payments_reconciled=' + str(row['balance'].get('paymentReconciled', False))
              + ('; sales_status=' + row['sales']['error'] if row['sales'].get('error') else ''), flush=True)
    try:
        snapshot['cashflow'] = cashflow_rows(client, snapshot['fromDate'], snapshot['toDate'])
    except SyncError as error:
        snapshot['cashflow'] = unavailable(error)
    try:
        products = catalog(client)
        snapshot['stocks'] = stocks(client, products)
        snapshot['stocks']['asOf'] = snapshot['generatedAt']
    except SyncError as error:
        snapshot['stocks'] = unavailable(error)
    print('cashflow=' + snapshot['cashflow']['state'] + '; stocks=' + snapshot['stocks']['state']
          + '; fbo=' + snapshot['stocks'].get('fboState', 'unavailable'), flush=True)
    for source in ('cashflow', 'stocks'):
        if snapshot[source].get('error'):
            print(source + ' status: ' + snapshot[source]['error'], flush=True)
    return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--year', type=int, default=dt.datetime.now(MSK).year)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    if args.publish and os.environ.get('OZON_PUBLICATION_APPROVED') != 'confirmed':
        raise SyncError('Public financial publication has not been approved')
    today = dt.datetime.now(MSK).date()
    if args.year < 2020 or args.year > today.year:
        raise SyncError('Unsupported reporting year')
    data = collect(Client(), args.year, today)
    # Validation produces no files containing monetary values, even as artifacts.
    status = dict(sellerConfirmed=True, year=args.year,
        sources={str(m['month']): {k:m.get(k,{}).get('state','future') for k in ('sales','balance')} for m in data['months']},
        stocks=data['stocks']['state'], cashflow=data['cashflow']['state'],
        publication='approved' if args.publish else 'not_published')
    if args.publish:
        target = ROOT / 'ozon-data.json'
        temporary = target.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':'))+'\n', encoding='utf-8')
        temporary.replace(target)
    print('Validation complete. Financial values are not written to logs.', flush=True)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a',encoding='utf-8') as handle:
            handle.write('## Ozon ООО «КЛМ»: проверка источников\n\n```json\n'+json.dumps(status,ensure_ascii=False,indent=2)+'\n```\n')


if __name__ == '__main__':
    try:
        main()
    except SyncError as error:
        print('Sync stopped: '+str(error), file=sys.stderr)
        sys.exit(1)
