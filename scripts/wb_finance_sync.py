"""Fetch WB accounting history; persist only daily sales/return aggregates.

API docs: https://dev.wildberries.ru/docs/openapi/documents-and-accounting
No raw response, credentials, report identifiers or customer information is saved.
"""
import datetime as dt
import gzip
import http.client
import io
import decimal
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

MOSCOW = dt.timezone(dt.timedelta(hours=3))
BASE = 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/'
FIELDS = ['rrdId', 'dateFrom', 'dateTo', 'currency', 'rrDate', 'sellerOperName',
          'docTypeName', 'quantity', 'retailAmount', 'returnAmount', 'deliveryAmount', 'bonusTypeName']

class SyncError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class Client:
    def __init__(self, token):
        self.token, self.last = token, 0
        self.opener = urllib.request.build_opener(NoRedirect)

    def post(self, endpoint, body):
        for attempt in range(4):
            delay = 61 - (time.monotonic() - self.last)
            if delay > 0:
                time.sleep(delay)
            self.last = time.monotonic()
            request = urllib.request.Request(BASE + endpoint,
                data=json.dumps(body).encode(), method='POST',
                headers={'Authorization': self.token, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip'})
            try:
                with self.opener.open(request, timeout=30) as response:
                    if response.status == 204:
                        return None
                    chunks, size, deadline = [], 0, time.monotonic() + 90
                    while True:
                        if time.monotonic() > deadline:
                            raise TimeoutError()
                        chunk = response.read1(65536)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > 100_000_000:
                            raise SyncError('WB response exceeds safety limit')
                        chunks.append(chunk)
                    payload = b''.join(chunks)
                    if response.headers.get('Content-Encoding', '').lower() == 'gzip':
                        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as compressed:
                            payload = compressed.read(100_000_001)
                        if len(payload) > 100_000_000:
                            raise SyncError('WB response exceeds safety limit')
                    result = json.loads(payload)
                    if not isinstance(result, list):
                        raise SyncError('Unexpected WB response format')
                    return result
            except urllib.error.HTTPError as error:
                # Never include WB's response body: it may contain private fields.
                if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                    continue
                raise SyncError('WB HTTP ' + str(error.code)) from None
            except (urllib.error.URLError, TimeoutError, http.client.IncompleteRead, ConnectionError, EOFError):
                print('WB transfer interrupted; retrying bounded page.' if attempt < 3 else 'WB transfer interrupted.', flush=True)
                if attempt == 3:
                    raise SyncError('WB network transfer incomplete') from None
        raise SyncError('WB request failed')

def day(value):
    try:
        return dt.date.fromisoformat(str(value)[:10]).isoformat()
    except (ValueError, TypeError):
        raise SyncError('Invalid accounting date') from None

def kopecks(value):
    if value is None or value == '':
        return None
    try:
        number = decimal.Decimal(str(value))
        scaled = number * 100
        if not scaled.is_finite() or scaled != scaled.to_integral_value() or scaled < 0:
            raise SyncError('Unexpected signed or fractional sale amount')
        if scaled > 9_007_199_254_740_991:
            raise SyncError('Amount exceeds supported precision')
        return int(scaled)
    except decimal.InvalidOperation:
        raise SyncError('Invalid sale amount') from None

PAYOUT_KINDS = {1: 'standard', 2: 'buyout', 3: 'georgia'}
PAYOUT_AMOUNTS = (
    ('retailAmountSum', 'retailKop', True),
    ('forPaySum', 'forPayKop', True),
    ('deliveryServiceSum', 'deliveryKop', True),
    ('paidStorageSum', 'storageKop', True),
    ('paidAcceptanceSum', 'acceptanceKop', True),
    ('deductionSum', 'deductionKop', True),
    ('penaltySum', 'penaltyKop', True),
    ('additionalPaymentSum', 'adjustmentKop', True),
    ('cashbackAmountSum', 'cashbackAmountKop', False),
    ('cashbackDiscountSum', 'cashbackDiscountKop', False),
    ('cashbackCommissionChangeSum', 'cashbackCommissionKop', False),
    ('paymentSchedule', 'paymentScheduleKop', False),
    ('bankPaymentSum', 'bankPaymentKop', True),
)

def signed_kopecks(value):
    if isinstance(value, bool) or isinstance(value, float):
        raise SyncError('Unexpected payout amount')
    if value is None or (isinstance(value, str) and not value.strip()):
        raise SyncError('Missing payout amount')
    try:
        number = decimal.Decimal(str(value).strip())
    except decimal.InvalidOperation:
        raise SyncError('Invalid payout amount') from None
    if not number.is_finite():
        raise SyncError('Invalid payout amount')
    scaled = number * 100
    if scaled != scaled.to_integral_value() or abs(scaled) > 9_007_199_254_740_991:
        raise SyncError('Unexpected payout amount')
    return int(scaled)

def payout_amount(report, key, required):
    if key not in report or report[key] is None or report[key] == '':
        if required:
            raise SyncError('WB payout total is incomplete')
        return None
    return signed_kopecks(report[key])

def payouts(reports, start, end, fetched):
    """Weekly 'итого к оплате' from the report list. Report ids and seller names are dropped."""
    if not any(isinstance(report, dict) and ('bankPaymentSum' in report or 'forPaySum' in report) for report in reports):
        return {'state': 'not_connected',
                'note': 'В списке отчётов WB нет итога к оплате. Начисление к выплате не опубликовано.'}
    chosen = {}
    for report in reports:
        if not isinstance(report, dict) or report.get('currency') != 'RUB':
            raise SyncError('Unsupported report currency')
        lo, hi = day(report.get('dateFrom')), day(report.get('dateTo'))
        if lo > hi:
            raise SyncError('Invalid payout period')
        if hi < start or lo > end:
            continue
        kind = PAYOUT_KINDS.get(report.get('reportType'))
        if kind is None:
            raise SyncError('Unsupported payout report type')
        formed = day(report.get('createDate'))
        amounts = {target: payout_amount(report, source, required) for source, target, required in PAYOUT_AMOUNTS}
        signature = tuple(amounts[target] for _, target, _ in PAYOUT_AMOUNTS)
        row = {'from': lo, 'to': hi, 'formed': formed, 'kind': kind}
        row.update(amounts)
        current = chosen.get((lo, hi, kind))
        if current is None or formed > current[0]:
            chosen[(lo, hi, kind)] = (formed, signature, row)
        elif formed == current[0] and signature != current[1]:
            raise SyncError('Conflicting payout report for the same week')
    if not chosen:
        raise SyncError('WB payout totals do not cover the requested year')
    rows = [item[2] for item in sorted(chosen.values(), key=lambda item: (item[2]['from'], item[2]['to'], item[2]['kind']))]
    return {'state': 'ready', 'fetchedAt': fetched, 'from': start, 'to': end, 'period': 'weekly',
            'basis': 'bankPaymentSum', 'rows': rows,
            'note': 'Итого к оплате по недельному отчёту WB. Это начисление к перечислению, не поступление на банковский счёт.'}

def merge_ranges(ranges):
    merged = []
    for start, end in sorted(set(map(tuple, ranges))):
        if merged and dt.date.fromisoformat(start) <= dt.date.fromisoformat(merged[-1][1]) + dt.timedelta(days=1):
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return merged

def aggregate(rows, reports, start, end, fetched):
    coverage = []
    for report in reports:
        if report.get('currency') != 'RUB':
            raise SyncError('Unsupported report currency')
        lo, hi = max(start, day(report['dateFrom'])), min(end, day(report['dateTo']))
        if lo <= hi:
            coverage.append([lo, hi])
    coverage = merge_ranges(coverage)
    seen, output, skipped = {}, {}, 0
    audit, logistics = {}, {}
    for row in rows:
        ident = row.get('rrdId')
        if not isinstance(ident, int) or isinstance(ident, bool) or ident <= 0:
            raise SyncError('Invalid accounting row ID')
        if ident in seen:
            if seen[ident] != row:
                raise SyncError('Conflicting duplicate accounting row')
            continue
        seen[ident] = row
        operation = row.get('sellerOperName')
        operation_key = (str(operation or ''), str(row.get('docTypeName') or ''))
        audit_item = audit.setdefault(operation_key, dict(rows=0, quantity=0, reverseDeliveryQty=0))
        audit_item['rows'] += 1
        if isinstance(row.get('quantity'), int):
            audit_item['quantity'] += row['quantity']
        audit_reverse = row.get('returnAmount')
        if isinstance(audit_reverse, int):
            audit_item['reverseDeliveryQty'] += audit_reverse
        if operation in ('Логистика', 'Доставка'):
            date = day(row.get('rrDate'))
            if start <= date <= end:
                reverse, forward = row.get('returnAmount'), row.get('deliveryAmount')
                if not all(isinstance(n, int) and not isinstance(n, bool) and n >= 0 for n in [reverse, forward]):
                    raise SyncError('Invalid logistics quantity')
                key = (date, str(row.get('bonusTypeName') or 'Без уточнения'))
                item = logistics.setdefault(key, dict(date=date, type=key[1], reverseQty=0, forwardQty=0))
                item['reverseQty'] += reverse
                item['forwardQty'] += forward
        if operation not in ('Продажа', 'Возврат'):
            skipped += 1
            continue
        if row.get('docTypeName') != operation:
            raise SyncError('Sale and document type disagree')
        date = day(row.get('rrDate'))
        if not start <= date <= end:
            continue
        if row.get('currency') != 'RUB':
            raise SyncError('Unsupported accounting currency')
        if not any(lo <= date <= hi for lo, hi in coverage):
            raise SyncError('Sale falls outside available report coverage')
        quantity = row.get('quantity')
        if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1:
            raise SyncError('Invalid sale quantity')
        amount = kopecks(row.get('retailAmount'))
        event = 'sale' if operation == 'Продажа' else 'return'
        key = (date, event)
        item = output.setdefault(key, dict(date=date, event=event, qty=0, knownAmountKop=0,
                                          missingAmountQty=0, zeroAmountQty=0))
        item['qty'] += quantity
        item['knownAmountKop'] += amount or 0
        item['missingAmountQty'] += quantity if amount is None else 0
        item['zeroAmountQty'] += quantity if amount == 0 else 0
    return {'schemaVersion': 1, 'generatedAt': fetched,
        'audit': [dict(operation=k[0], document=k[1], **v) for k,v in sorted(audit.items())],
        'reverseLogistics': {'state': 'ready', 'fetchedAt': fetched, 'coverage': coverage,
                             'rows': [logistics[k] for k in sorted(logistics)]},
        'sales': {'state': 'ready', 'fetchedAt': fetched, 'from': start, 'to': end,
                  'coverage': coverage, 'rows': [output[key] for key in sorted(output)],
                  'basis': 'retailAmount', 'dateBasis': 'rrDate', 'period': 'weekly',
                  'reportCount': len(reports), 'excludedOtherOperationRows': skipped},
        'payouts': payouts(reports, start, end, fetched)}

def sync(client, start, end, fetched):
    reports, offset = [], 0
    while True:
        page = client.post('list', dict(dateFrom=start, dateTo=end, limit=1000, offset=offset, period='weekly'))
        reports.extend(page or [])
        if not page or len(page) < 1000:
            break
        offset += len(page)
        if offset > 10000:
            raise SyncError('Report pagination limit exceeded')
    rows, cursor = [], 0
    while True:
        print('Loading next bounded finance page.', flush=True)
        page = client.post('detailed', dict(dateFrom=start, dateTo=end, limit=10000,
                                           rrdId=cursor, period='weekly', fields=FIELDS))
        if not page:
            break
        next_cursor = page[-1].get('rrdId')
        if not isinstance(next_cursor, int) or next_cursor <= cursor:
            raise SyncError('Accounting pagination did not advance')
        rows.extend(page)
        cursor = next_cursor
        if len(rows) > 2_000_000:
            raise SyncError('Accounting history exceeds supported size')
    return aggregate(rows, reports, start, end, fetched)

def main():
    token = os.environ.get('WB_IP_FINANCE_API_TOKEN', '').strip()
    if not token or any(c.isspace() for c in token):
        raise SyncError('Repository secret WB_IP_FINANCE_API_TOKEN is missing or invalid')
    now = dt.datetime.now(MOSCOW)
    year = int(os.environ.get('WB_FINANCE_YEAR') or now.year)
    if not 2024 <= year <= now.year:
        raise SyncError('Unsupported history year')
    start, end = f'{year}-01-01', min(f'{year}-12-31', now.date().isoformat())
    result = sync(Client(token), start, end, now.isoformat(timespec='seconds'))
    if not result['sales']['coverage']:
        raise SyncError('WB returned no financial reports for requested year')
    payout = result.get('payouts') or {}
    if payout.get('state') != 'ready' or not payout.get('rows'):
        raise SyncError('WB report list did not include payout totals')
    target = pathlib.Path('wb-finance.json')
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    s, payout_rows = result['sales'], result['payouts']['rows']
    standard = sum(row['kind'] == 'standard' for row in payout_rows)
    print(f"Finance history ready: {s['reportCount']} reports, {len(s['rows'])} daily aggregates, {standard} weekly payout totals.")
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as stream:
            stream.write('## Финансовая история WB ИП\n\nПроверка токена успешна. Получены недельные отчёты за ' + start + '–' + end + '.\n\n'
                         'Фактическое покрытие продаж: ' + ', '.join(a + '–' + b for a,b in s['coverage']) + '.\n\n'
                         'К оплате опубликовано по ' + str(standard) + ' недельным отчётам. Это начисление отчёта, не банковская выписка.\n\n'
                         'Опубликованы только сводные суммы. Токен, номера отчётов и наименование продавца не публикуются.\n')

if __name__ == '__main__':
    try:
        main()
    except (SyncError, KeyError, ValueError, TypeError, json.JSONDecodeError) as error:
        # Only our own sanitized errors may be shown.
        print('Finance sync failed: ' + (str(error) if isinstance(error, SyncError) else 'Unexpected report schema'), file=sys.stderr)
        sys.exit(1)
