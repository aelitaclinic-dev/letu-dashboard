import importlib.util
import json
import unittest
from decimal import Decimal

spec = importlib.util.spec_from_file_location('ozon', 'scripts/ozon_sync.py')
ozon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ozon)


class OzonTests(unittest.TestCase):
    def money(self, value):
        return dict(value=value, currency_code='RUB')

    def report(self):
        return dict(result=dict(header=dict(start_date='2026-10-01', stop_date='2026-10-31',
            currency_sys_name='RUR', receiver_inn='PRIVATE'), rows=[dict(rowNumber=1,
                item=dict(name='Product', offer_id='SKU1', sku=123, private='PRIVATE'),
                seller_price_per_instance=Decimal('100.01'),
                delivery_commission=dict(quantity=3, amount=Decimal('200.00'), total=Decimal('250.01')),
                return_commission=dict(quantity=1, amount=Decimal('50.00'), total=Decimal('80.01')))]))

    def test_unit_price_and_aggregate_amounts_are_not_confused(self):
        result = ozon.realization(self.report(), 2026, 10)
        self.assertEqual(result['salesKop'], 30003)
        self.assertEqual(result['returnsKop'], 10001)
        self.assertEqual(result['reportAccruedKop'], 17000)
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('receiver_inn', json.dumps(result))

    def test_missing_reports_and_prices_cannot_be_zero_sales(self):
        with self.assertRaises(ozon.SyncError):
            ozon.realization({}, 2026, 10)
        report = self.report()
        del report['result']['rows'][0]['seller_price_per_instance']
        with self.assertRaises(ozon.SyncError):
            ozon.realization(report, 2026, 10)

    def test_empty_valid_report_is_zero_but_wrong_period_is_rejected(self):
        report = self.report()
        report['result']['rows'] = []
        self.assertEqual(ozon.realization(report, 2026, 10)['salesKop'], 0)
        with self.assertRaises(ozon.SyncError):
            ozon.realization(report, 2026, 9)

    def test_duplicate_rows_fail_instead_of_double_counting(self):
        report = self.report()
        report['result']['rows'] *= 2
        with self.assertRaises(ozon.SyncError):
            ozon.realization(report, 2026, 10)

    def test_balance_determines_payout_sign_by_reconciliation(self):
        def data(payment):
            return dict(total=dict(opening_balance=self.money('100'), closing_balance=self.money('80'),
                accrued=self.money('30'), payments=[self.money(payment)]))
        self.assertEqual(ozon.balance(data('50'))['paidKop'], 5000)
        self.assertEqual(ozon.balance(data('-50'))['paidKop'], 5000)
        self.assertIsNone(ozon.balance(data('45'))['paidKop'])
        self.assertFalse(ozon.balance(data('45'))['paymentReconciled'])

    def test_wrong_currency_and_fractional_kopecks_rejected(self):
        with self.assertRaises(ozon.SyncError):
            ozon.rub_money(dict(value=1,currency_code='USD'))
        with self.assertRaises(ozon.SyncError):
            ozon.kop(Decimal('1.001'))
        self.assertEqual(ozon.kop(Decimal('-1.01')), -101)

    def test_fee_buckets_and_nested_commission(self):
        self.assertEqual(ozon.fee_bucket('Штраф за опоздание'), 'fines')
        self.assertEqual(ozon.fee_bucket('Компенсация за утерю'), 'compensation')
        found = []
        ozon.walk_fees({'posting': {'products': [{'commission': {'sale_commission': Decimal('-12.50')},
            'delivery': {'services': [{'type_id': 9, 'accrued': {'amount': Decimal('-3.00'), 'currency_code': 'RUB'}}]}}]}}, found)
        amounts = dict(found)
        self.assertEqual(amounts['sale_commission'], -1250)
        self.assertEqual(amounts[9], -300)

    def test_posting_duplicates_fail_and_status_is_not_a_sale(self):
        posting = dict(posting_number='1', created_at='2026-11-02T10:00:00+03:00', status='awaiting_deliver',
                       products=[dict(offer_id='SKU1', name='A', quantity=2, price='100.00')])
        class Once:
            def post(self, endpoint, body):
                return dict(result=dict(postings=[posting], has_next=False))
        months = ozon.collect_postings(Once(), '/v3/posting/fbs/list', 'FBS/rFBS', '2026-01-01', '2026-11-16')
        self.assertEqual(months[0]['orderedQty'], 2)
        self.assertEqual(months[0]['deliveredQty'], 0)
        self.assertEqual(months[0]['inProgressQty'], 2)
        class Dup:
            def post(self, endpoint, body):
                return dict(result=dict(postings=[posting, posting], has_next=False))
        with self.assertRaises(ozon.SyncError):
            ozon.collect_postings(Dup(), '/v3/posting/fbs/list', 'FBS/rFBS', '2026-01-01', '2026-11-16')

    def test_accrual_cursor_repeat_fails(self):
        class Client:
            def post(self, endpoint, body):
                if endpoint.endswith('/types'):
                    return dict(types=[dict(id=1, name='Комиссия')])
                return dict(accruals=[dict(accrual_id=1, date='2026-11-01')], last_id='same')
        with self.assertRaises(ozon.SyncError):
            ozon.collect_accruals(Client(), '2026-11-01', '2026-11-01', {1: 'Комиссия'})

    def test_cashflow_duplicate_pages_fail(self):
        flow = dict(period=dict(id=1,begin='2026-01-01',end='2026-01-15'), currency_code='RUB',
            orders_amount=0,returns_amount=0,commission_amount=0,services_amount=0,item_delivery_and_return_amount=0)
        class Client:
            def post(self, *args):
                return dict(result=dict(page_count=2,cash_flows=[flow],details=[]))
        with self.assertRaises(ozon.SyncError):
            ozon.cashflow_rows(Client(),'2026-01-01','2026-11-15')

    def test_cashflow_keeps_open_week_past_requested_end(self):
        flow = dict(period=dict(id=9,begin='2026-11-16',end='2026-11-22'), currency_code='RUB',
            orders_amount=0,returns_amount=0,commission_amount=0,services_amount=0,item_delivery_and_return_amount=0)
        detail = dict(period=dict(begin='2026-11-16',end='2026-11-22'), payments=[],
            begin_balance_amount=0, end_balance_amount=0)
        class Client:
            def post(self, *args):
                return dict(result=dict(page_count=1,cash_flows=[flow],details=[detail]))
        result = ozon.cashflow_rows(Client(),'2026-01-01','2026-11-16')
        self.assertEqual(result['state'], 'ready')
        self.assertEqual(result['periods'][0]['toDate'], '2026-11-22')

    def test_accrual_types_empty_result_is_usable_catalog(self):
        class Client:
            def post(self, *args):
                return dict(result=None)
        self.assertEqual(ozon.accrual_types(Client()), {})


if __name__ == '__main__':
    unittest.main()
