"""Fetch WB accounting history; persist only daily sales/return aggregates.

API docs: https://dev.wildberries.ru/docs/openapi/documents-and-accounting
No raw response, credentials, report identifiers or customer information is saved.
"""
import datetime as dt
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
          'docTypeName', 'quantity', 'retailAmount']

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
                headers={'Authorization': self.token, 'Content-Type': 'application/json'})
            try:
                with self.opener.open(request, timeout=120) as response:
                    if response.status == 204:
                        return None
                    payload = response.read(100_000_001)
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
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise SyncError('WB network timeout') from None
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
        'sales': {'state': 'ready', 'fetchedAt': fetched, 'from': start, 'to': end,
                  'coverage': coverage, 'rows': [output[key] for key in sorted(output)],
                  'basis': 'retailAmount', 'dateBasis': 'rrDate', 'period': 'weekly',
                  'reportCount': len(reports), 'excludedOtherOperationRows': skipped}}

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
        page = client.post('detailed', dict(dateFrom=start, dateTo=end, limit=100000,
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
    target = pathlib.Path('wb-finance.json')
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    s = result['sales']
    print(f"Finance history ready: {s['reportCount']} reports, {len(s['rows'])} daily aggregates.")
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as stream:
            stream.write('## Финансовая история WB ИП\n\nПроверка токена успешна. Получены недельные отчёты за ' + start + '–' + end + '.\n\n'
                         'Фактическое покрытие: ' + ', '.join(a + '–' + b for a,b in s['coverage']) + '.\n\n'
                         'Опубликованы только дневные итоги продаж и возвратов. Токен и исходные отчёты не публикуются.\n')

if __name__ == '__main__':
    try:
        main()
    except (SyncError, KeyError, ValueError, TypeError, json.JSONDecodeError) as error:
        # Only our own sanitized errors may be shown.
        print('Finance sync failed: ' + (str(error) if isinstance(error, SyncError) else 'Unexpected report schema'), file=sys.stderr)
        sys.exit(1)
