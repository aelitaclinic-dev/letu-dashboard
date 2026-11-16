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
            # period.id is not unique in Ozon's historical reports.
            key = (period.get('begin'), period.get('end'), row.get('currency_code'))
            if key in seen or not all(key):
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
            payment_rows = []
            payments = 0
            for item in row['payments']:
                amount = rub_money(item, 'payment')
                payments += amount
                day = str(item.get('date') or item.get('payment_date') or stop)[:10]
                if not start <= day <= end:
                    raise SyncError('Cash-flow payment date outside requested year')
                payment_rows.append(dict(date=day, amountKop=amount))
            details.append(dict(fromDate=begin, toDate=stop, reportedPaymentsKop=payments,
                openingKop=kop(row.get('begin_balance_amount')), closingKop=kop(row.get('end_balance_amount')),
                payments=payment_rows))
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
                           {'limit':1000, 'cursor':cursor, 'sku':skus})
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


FEE_BUCKETS = (
    ('fines', ('штраф', 'удерж', 'fine', 'penalty', 'антифрод', 'decompensat', 'withhold')),
    ('compensation', ('компенс', 'compensat')),
    ('adjustments', ('корректир', 'adjustment', 'correction')),
    ('commission', ('комисс', 'commission', 'вознагражд')),
    ('logistics', ('логист', 'достав', 'мил', 'pipeline', 'last mile', 'drop-off', 'dropoff', 'возврат достав', 'delivery_total')),
    ('storage', ('хранен', 'storage')),
)


def fee_bucket(name):
    text = str(name or '').casefold()
    for bucket, needles in FEE_BUCKETS:
        if any(needle in text for needle in needles):
            return bucket
    return 'services'


def money_node(value):
    if isinstance(value, dict):
        code = value.get('currency_code') or value.get('currency')
        if code not in (None, 'RUB', 'RUR'):
            raise SyncError('Unsupported currency')
        for field in ('value', 'amount', 'payment'):
            if value.get(field) is not None:
                return kop(value.get(field))
        raise SyncError('Missing money or unsupported currency')
    return kop(value)


def walk_fees(node, found):
    if isinstance(node, dict):
        if 'type_id' in node and isinstance(node.get('accrued'), dict):
            found.append((node.get('type_id'), money_node(node['accrued'])))
            return
        for field, type_id in (('sale_commission', 'sale_commission'), ('delivery_total', 'delivery_total')):
            value = node.get(field)
            if value is None or isinstance(value, bool):
                continue
            try:
                found.append((type_id, money_node(value) if isinstance(value, dict) else kop(value)))
            except SyncError:
                continue
        for key, child in node.items():
            if key in ('sale_commission', 'delivery_total'):
                continue
            walk_fees(child, found)
    elif isinstance(node, list):
        for child in node:
            walk_fees(child, found)


def accrual_types(client):
    data = client.post('/v1/finance/accrual/types', {})
    rows = data.get('types') if isinstance(data.get('types'), list) else data.get('result')
    if isinstance(rows, dict):
        rows = rows.get('types')
    if not isinstance(rows, list):
        raise SyncError('Invalid accrual type catalog')
    catalog = {}
    for row in rows:
        type_id = row.get('id', row.get('type_id'))
        if type_id is None or type_id in catalog:
            raise SyncError('Missing or duplicate accrual type')
        catalog[type_id] = str(row.get('name') or row.get('title') or type_id)[:160]
    return catalog


def collect_accruals(client, start, end, catalog):
    empty = {key: 0 for key in ('commissionKop', 'logisticsKop', 'storageKop', 'servicesKop',
                                 'finesKop', 'compensationKop', 'adjustmentsKop')}
    months, seen, types = {}, set(), {}
    day = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    while day <= last:
        cursor = ''
        for page in range(200):
            body = {'date': day.isoformat()}
            if cursor:
                body['last_id'] = cursor
            data = client.post('/v1/finance/accrual/by-day', body)
            rows = data.get('accruals')
            if rows is None and isinstance(data.get('result'), dict):
                rows = data['result'].get('accruals')
            if not isinstance(rows, list):
                raise SyncError('Invalid daily accrual page')
            for row in rows:
                accrual_id = row.get('accrual_id')
                if accrual_id is None or accrual_id in seen:
                    raise SyncError('Missing or duplicate accrual')
                seen.add(accrual_id)
                month = (str(row.get('date') or day.isoformat())[:7])
                bucket_row = months.setdefault(month, dict(month=month, **empty, types={}))
                fees = []
                walk_fees(row, fees)
                if not fees:
                    continue
                for type_id, amount in fees:
                    name = catalog.get(type_id, 'Тип ' + str(type_id))
                    key = fee_bucket(name) + 'Kop'
                    bucket_row[key] += amount
                    type_row = bucket_row['types'].setdefault(str(type_id), dict(typeId=str(type_id), name=name, amountKop=0))
                    type_row['amountKop'] += amount
                    types.setdefault(str(type_id), name)
            next_cursor = data.get('last_id') or (data.get('result') or {}).get('last_id') or ''
            if not next_cursor or not rows:
                break
            if next_cursor == cursor:
                raise SyncError('Accrual cursor repeated')
            cursor = next_cursor
        else:
            raise SyncError('Accrual pagination exceeds limit')
        day += dt.timedelta(days=1)
    result = []
    for month in sorted(months):
        row = months[month]
        row['types'] = sorted(row['types'].values(), key=lambda item: item['typeId'])
        result.append(row)
    return dict(state='ready', months=result, typeNames=types)


def empty_ops():
    return dict(orderedQty=0, cancelledQty=0, deliveredQty=0, returnedQty=0, inProgressQty=0,
                orderedKop=0, cancelledKop=0, deliveredKop=0, returnedKop=0, missingPrice=False,
                products={})


def posting_group(status):
    value = str(status or '').casefold()
    if value in {'delivered'}:
        return 'delivered'
    if value in {'cancelled', 'canceled', 'not_accepted'}:
        return 'cancelled'
    if 'return' in value:
        return 'returned'
    return 'inProgress'


def offer_money(product):
    article = str(product.get('offer_id') or product.get('offerId') or '').strip()
    if not article:
        raise SyncError('Missing seller article')
    raw_qty = product.get('quantity', 0)
    if isinstance(raw_qty, bool) or not isinstance(raw_qty, int):
        try:
            raw_qty = int(raw_qty)
        except (TypeError, ValueError):
            raise SyncError('Invalid quantity') from None
    qty = quantity(raw_qty)
    price = product.get('price')
    if price in (None, ''):
        return article, str(product.get('name', ''))[:350], qty, None
    return article, str(product.get('name', ''))[:350], qty, kop(price) * qty


def add_ops(target, group, article, name, qty, amount):
    product = target['products'].setdefault(article, dict(article=article, name=name,
        orderedQty=0, cancelledQty=0, deliveredQty=0, returnedQty=0, orderedKop=0, cancelledKop=0,
        deliveredKop=0, returnedKop=0))
    target['orderedQty'] += qty
    product['orderedQty'] += qty
    if amount is None:
        target['missingPrice'] = True
    else:
        target['orderedKop'] += amount
        product['orderedKop'] += amount
    if group == 'inProgress':
        target['inProgressQty'] += qty
        return
    target[group + 'Qty'] += qty
    product[group + 'Qty'] += qty
    if amount is not None:
        target[group + 'Kop'] += amount
        product[group + 'Kop'] += amount


def collect_postings(client, endpoint, scheme, start, end):
    seen, months, offset = set(), {}, 0
    since = start + 'T00:00:00+03:00'
    until = end + 'T23:59:59+03:00'
    for page in range(200):
        data = client.post(endpoint, {
            'dir': 'ASC',
            'filter': {'since': since, 'to': until},
            'limit': 1000,
            'offset': offset,
            'with': {'analytics_data': False, 'financial_data': False},
        })
        result = data.get('result', data)
        rows = result.get('postings') if isinstance(result, dict) else None
        has_next = result.get('has_next') if isinstance(result, dict) else False
        if not isinstance(rows, list) or not isinstance(has_next, bool):
            raise SyncError('Invalid posting page')
        for row in rows:
            number = row.get('posting_number')
            if not number or number in seen:
                raise SyncError('Missing or duplicate posting')
            seen.add(number)
            created = str(row.get('in_process_at') or row.get('created_at') or '')[:10]
            if not created or created < start or created > end:
                continue
            month = created[:7]
            target = months.setdefault(month, empty_ops())
            group = posting_group(row.get('status'))
            products = row.get('products')
            if not isinstance(products, list):
                raise SyncError('Invalid posting products')
            for product in products:
                article, name, qty, amount = offer_money(product)
                add_ops(target, group, article, name, qty, amount)
        if not has_next:
            result_months = []
            for month in sorted(months):
                row = months[month]
                row['month'] = month
                row['products'] = sorted(row['products'].values(), key=lambda item: item['article'])
                row['scheme'] = scheme
                result_months.append(row)
            return result_months
        if not rows:
            raise SyncError('Posting pagination stalled')
        offset += len(rows)
    raise SyncError('Posting pagination exceeds limit')


def merge_ops(parts):
    merged = {}
    for part in parts:
        month = part['month']
        target = merged.setdefault(month, empty_ops())
        target['missingPrice'] = target['missingPrice'] or part['missingPrice']
        for key in ('orderedQty', 'cancelledQty', 'deliveredQty', 'returnedQty', 'inProgressQty',
                    'orderedKop', 'cancelledKop', 'deliveredKop', 'returnedKop'):
            target[key] += part[key]
        for product in part['products']:
            row = target['products'].setdefault(product['article'], dict(article=product['article'],
                name=product['name'], orderedQty=0, cancelledQty=0, deliveredQty=0, returnedQty=0,
                orderedKop=0, cancelledKop=0, deliveredKop=0, returnedKop=0))
            for key in ('orderedQty', 'cancelledQty', 'deliveredQty', 'returnedQty',
                        'orderedKop', 'cancelledKop', 'deliveredKop', 'returnedKop'):
                row[key] += product[key]
    result = []
    for month in sorted(merged):
        row = merged[month]
        row['month'] = month
        row['products'] = sorted(row['products'].values(), key=lambda item: item['article'])
        row['preliminary'] = True
        row['state'] = 'ready'
        result.append(row)
    return result


def collect_operations(client, start, end):
    parts, errors = [], []
    for endpoint, scheme in (('/v3/posting/fbs/list', 'FBS/rFBS'), ('/v2/posting/fbo/list', 'FBO')):
        try:
            parts.extend(collect_postings(client, endpoint, scheme, start, end))
        except SyncError as error:
            errors.append(scheme + ': ' + str(error))
    if not parts:
        raise SyncError('; '.join(errors) if errors else 'No postings')
    return dict(state='ready', basis='posting status counts, not realization',
                months=merge_ops(parts), schemeErrors=errors or None)


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
    snapshot['payouts'] = payout_dates(snapshot['cashflow'])
    snapshot['debt'] = seller_debt(snapshot['months'])
    try:
        snapshot['operations'] = collect_operations(client, snapshot['fromDate'], snapshot['toDate'])
    except SyncError as error:
        snapshot['operations'] = unavailable(error)
    attach_operations(snapshot)
    try:
        snapshot['accruals'] = collect_accruals(client, snapshot['fromDate'], snapshot['toDate'], accrual_types(client))
    except SyncError as error:
        snapshot['accruals'] = unavailable(error)
    attach_accruals(snapshot)
    try:
        products = catalog(client)
        snapshot['stocks'] = stocks(client, products)
        snapshot['stocks']['asOf'] = snapshot['generatedAt']
    except SyncError as error:
        snapshot['stocks'] = unavailable(error)
    snapshot['unavailableReports'] = missing_reports(snapshot)
    print('cashflow=' + snapshot['cashflow']['state'] + '; stocks=' + snapshot['stocks']['state']
          + '; operations=' + snapshot['operations']['state']
          + '; accruals=' + snapshot['accruals']['state']
          + '; fbo=' + snapshot['stocks'].get('fboState', 'unavailable'), flush=True)
    for source in ('cashflow', 'stocks', 'operations', 'accruals'):
        if snapshot[source].get('error'):
            print(source + ' status: ' + snapshot[source]['error'], flush=True)
    return snapshot


def payout_dates(cashflow):
    if cashflow.get('state') != 'ready':
        return dict(state='unavailable', error=cashflow.get('error', 'Cash-flow report is unavailable'))
    combined = {}
    for detail in cashflow.get('details', []):
        for row in detail.get('payments', []):
            combined[row['date']] = combined.get(row['date'], 0) + row['amountKop']
    return dict(state='ready', rows=[{'date': day, 'amountKop': combined[day]} for day in sorted(combined)])


def seller_debt(months):
    ready = [row for row in months if row.get('balance', {}).get('state') == 'ready']
    if not ready:
        return dict(state='unavailable', error='No balance report')
    last = ready[-1]
    closing = last['balance']['closingKop']
    return dict(state='ready', asOf=last['toDate'], closingKop=closing,
                ozonOwesSellerKop=closing if closing > 0 else 0,
                sellerOwesOzonKop=-closing if closing < 0 else 0)


def attach_operations(snapshot):
    by_month = {row['month']: row for row in snapshot.get('operations', {}).get('months', [])}
    for row in snapshot['months']:
        if row.get('state') == 'future':
            continue
        ops = by_month.get(row['month'])
        row['operations'] = dict(ops, state='ready') if ops else unavailable('No postings in this month')
        if row['operations']['state'] == 'ready' and row.get('partial'):
            row['operations']['preliminary'] = True


def attach_accruals(snapshot):
    by_month = {row['month']: row for row in snapshot.get('accruals', {}).get('months', [])}
    for row in snapshot['months']:
        if row.get('state') == 'future':
            continue
        acc = by_month.get(row['month'])
        row['accruals'] = dict(acc, state='ready') if acc else (
            dict(state='ready', month=row['month'], commissionKop=0, logisticsKop=0, storageKop=0,
                 servicesKop=0, finesKop=0, compensationKop=0, adjustmentsKop=0, types=[])
            if snapshot.get('accruals', {}).get('state') == 'ready' else unavailable(snapshot.get('accruals', {}).get('error', 'No accruals'))
        )


def missing_reports(snapshot):
    reports = []
    for row in snapshot['months']:
        if row.get('state') == 'future':
            continue
        if row.get('sales', {}).get('state') != 'ready':
            label = 'Предварительно: месячный отчёт реализации ещё не сформирован' if row.get('partial') else 'Нет данных'
            reports.append(dict(month=row['month'], source='realization', label=label,
                                error=row.get('sales', {}).get('error')))
        if row.get('balance', {}).get('state') != 'ready':
            reports.append(dict(month=row['month'], source='balance', label='Нет данных',
                                error=row.get('balance', {}).get('error')))
    if snapshot.get('operations', {}).get('state') != 'ready':
        reports.append(dict(month=None, source='operations', label='Нет данных',
                            error=snapshot['operations'].get('error')))
    if snapshot.get('accruals', {}).get('state') != 'ready':
        reports.append(dict(month=None, source='accruals', label='Нет данных',
                            error=snapshot['accruals'].get('error')))
    if snapshot.get('cashflow', {}).get('state') != 'ready':
        reports.append(dict(month=None, source='cashflow', label='Нет данных',
                            error=snapshot['cashflow'].get('error')))
    if snapshot.get('stocks', {}).get('state') != 'ready':
        reports.append(dict(month=None, source='stocks', label='Нет данных',
                            error=snapshot['stocks'].get('error')))
    elif snapshot['stocks'].get('fboState') != 'ready':
        reports.append(dict(month=None, source='stocks-fbo', label='Нет данных',
                            error=snapshot['stocks'].get('fboError')))
    if snapshot.get('stocks', {}).get('historicalState') == 'not_available':
        reports.append(dict(month=None, source='historical-stocks',
                            label='Исторические остатки API не восстанавливает', error=None))
    return reports


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
        sources={str(m['month']): {k:m.get(k,{}).get('state','future') for k in ('sales','balance','operations')} for m in data['months']},
        stocks=data['stocks']['state'], cashflow=data['cashflow']['state'],
        operations=data['operations']['state'], accruals=data['accruals']['state'],
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
