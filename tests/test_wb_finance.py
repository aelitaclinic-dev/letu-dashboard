import importlib.util
import unittest
import gzip
import json
import http.client
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('sync','scripts/wb_finance_sync.py')
sync=importlib.util.module_from_spec(spec); spec.loader.exec_module(sync)

class FinanceTests(unittest.TestCase):
    def row(self, **updates):
        return dict(rrdId=1, rrDate='2026-01-12', currency='RUB', sellerOperName='Продажа',
                    docTypeName='Продажа', quantity=2, retailAmount='150.01', **updates)
    def calc(self, rows):
        reports=[dict(dateFrom='2025-12-29',dateTo='2026-01-11',currency='RUB'),dict(dateFrom='2026-01-12',dateTo='2026-01-18',currency='RUB')]
        return sync.aggregate(rows,reports,'2026-01-01','2026-10-31','2026-10-31T23:00:00+03:00')
    def test_total_is_not_unit_price_and_no_private_fields(self):
        row=self.row(); row['srid']='PRIVATE'; row['buyerTaxRegistrationReasonCode']='PRIVATE'
        result=self.calc([row,row]); self.assertEqual(result['sales']['rows'][0]['knownAmountKop'],15001)
        self.assertEqual(result['sales']['rows'][0]['qty'],2)
        self.assertNotIn('PRIVATE',str(result)); self.assertEqual(result['sales']['coverage'],[['2026-01-01','2026-01-18']])
    def test_returns_and_non_sale_rows(self):
        row=self.row(); row.update(sellerOperName='Возврат',docTypeName='Возврат')
        logistic=self.row(); logistic.update(rrdId=2,sellerOperName='Логистика',returnAmount=1,deliveryAmount=0,bonusTypeName='От клиента при отказе')
        result=self.calc([row,logistic]); self.assertEqual(result['sales']['rows'][0]['event'],'return')
        self.assertEqual(result['sales']['excludedOtherOperationRows'],1)
        self.assertEqual(result['reverseLogistics']['rows'][0]['reverseQty'],1)
        self.assertEqual(result['sales']['rows'][0]['qty'],2)
    def test_delivery_and_logistics_both_count_without_refund_deduction(self):
        logistic=self.row(); logistic.update(rrdId=2,sellerOperName='Логистика',returnAmount=3,deliveryAmount=0,bonusTypeName='От клиента при отмене')
        delivery=dict(logistic,rrdId=3,sellerOperName='Доставка',returnAmount=2)
        result=self.calc([self.row(),logistic,delivery])
        self.assertEqual(sum(r['reverseQty'] for r in result['reverseLogistics']['rows']),5)
        self.assertEqual(sum(r['qty'] for r in result['sales']['rows']),2)
        self.assertEqual(sum(r['knownAmountKop'] for r in result['sales']['rows']),15001)
        self.assertEqual(sum(r['reverseDeliveryQty'] for r in result['audit']),5)
    def test_conflicting_duplicates_fail(self):
        other=self.row(); other['quantity']=3
        with self.assertRaises(sync.SyncError): self.calc([self.row(),other])
    def test_missing_amount_is_not_zero(self):
        row=self.row(); row['retailAmount']=None
        self.assertEqual(self.calc([row])['sales']['rows'][0]['missingAmountQty'],2)
    def test_gap_and_out_of_coverage_fail(self):
        row=self.row(); row['rrDate']='2026-02-01'
        with self.assertRaises(sync.SyncError): self.calc([row])
    def test_pagination_until_204(self):
        reports=[dict(dateFrom='2026-01-12',dateTo='2026-01-18',currency='RUB')]
        pages=iter([reports,[self.row()],None]); calls=[]
        class Fake:
            def post(self,endpoint,body): calls.append((endpoint,body)); return next(pages)
        sync.sync(Fake(),'2026-01-01','2026-10-31','2026-10-31')
        self.assertEqual(calls[-1][1]['rrdId'],1); self.assertEqual(calls[1][1]['period'],'weekly')
    def test_gzip_and_interrupted_transfer_retry(self):
        body=gzip.compress(json.dumps([{'rrdId':123}]).encode())
        class Response:
            status=200
            headers={'Content-Encoding':'gzip'}
            def __init__(self): self.parts=iter([body[:5],body[5:],b''])
            def read1(self,n): return next(self.parts)
            def __enter__(self): return self
            def __exit__(self,*args): pass
        class Opener:
            def __init__(self): self.calls=0
            def open(self,request,timeout):
                self.calls+=1
                if self.calls==1: raise http.client.IncompleteRead(b'partial')
                return Response()
        client=sync.Client('test-secret');client.opener=Opener()
        with patch.object(sync.time,'sleep'):
            result=client.post('detailed',{})
        self.assertEqual(result,[{'rrdId':123}])
        self.assertEqual(client.opener.calls,2)
    def test_amount_precision(self):
        self.assertEqual(sync.kopecks('0.01'),1)
        for value in ['-1','NaN','0.001']:
            with self.assertRaises(sync.SyncError): sync.kopecks(value)
    def report(self, **updates):
        base=dict(dateFrom='2026-01-05',dateTo='2026-01-11',createDate='2026-01-12',currency='RUB',reportType=1,
                  retailAmountSum='1000.00',forPaySum='700.00',deliveryServiceSum='50.00',paidStorageSum='10.00',
                  paidAcceptanceSum='0',deductionSum='5.00',penaltySum='0.00',additionalPaymentSum='-1.50',
                  cashbackAmountSum='0.00',cashbackDiscountSum=None,cashbackCommissionChangeSum='',paymentSchedule='-3.50',
                  bankPaymentSum='635.00',reportId=987654321,sellerFinanceName='SECRET-SELLER')
        base.update(updates); return base
    def test_payout_uses_bank_total_and_drops_identity(self):
        result=sync.payouts([self.report()],'2026-01-01','2026-11-12','2026-11-12T12:00:00+03:00')
        row=result['rows'][0]
        self.assertEqual(row['bankPaymentKop'],63500)
        self.assertEqual(row['forPayKop'],70000)
        self.assertEqual(row['adjustmentKop'],-150)
        self.assertEqual(row['paymentScheduleKop'],-350)
        self.assertIsNone(row['cashbackDiscountKop'])
        self.assertEqual(row['kind'],'standard')
        dumped=json.dumps(result)
        self.assertNotIn('SECRET-SELLER',dumped); self.assertNotIn('987654321',dumped); self.assertNotIn('reportId',dumped)
    def test_later_payout_replaces_same_week(self):
        older=self.report(bankPaymentSum='100.00')
        newer=self.report(createDate='2026-01-20',bankPaymentSum='80.00')
        rows=sync.payouts([older,newer],'2026-01-01','2026-12-31','2026-11-12T12:00:00+03:00')['rows']
        self.assertEqual(len(rows),1); self.assertEqual(rows[0]['bankPaymentKop'],8000); self.assertEqual(rows[0]['formed'],'2026-01-20')
    def test_conflicting_payout_same_day_fails(self):
        with self.assertRaises(sync.SyncError):
            sync.payouts([self.report(),self.report(bankPaymentSum='1.00')],'2026-01-01','2026-12-31','2026-11-12T12:00:00+03:00')
    def test_buyout_stays_separate_and_prior_year_is_left_out(self):
        rows=sync.payouts([
            self.report(dateFrom='2025-12-22',dateTo='2025-12-28',createDate='2025-12-29'),
            self.report(dateFrom='2025-12-29',dateTo='2026-01-04',createDate='2026-01-05',bankPaymentSum='10.00'),
            self.report(reportType=2,bankPaymentSum='4.00'),
        ],'2026-01-01','2026-12-31','2026-11-12T12:00:00+03:00')['rows']
        self.assertEqual([(r['kind'], r['bankPaymentKop'], r['from']) for r in rows],[('standard',1000,'2025-12-29'),('buyout',400,'2026-01-05')])
    def test_incomplete_or_fractional_payout_fails(self):
        for broken in [self.report(bankPaymentSum=None), self.report(bankPaymentSum='0.001'), self.report(bankPaymentSum=1.25),
                       self.report(currency='USD'), self.report(reportType=9)]:
            with self.assertRaises(sync.SyncError):
                sync.payouts([broken],'2026-01-01','2026-12-31','2026-11-12T12:00:00+03:00')
    def test_sales_sync_without_payout_fields_stays_unconnected(self):
        result=self.calc([self.row()])
        self.assertEqual(result['payouts']['state'],'not_connected')
        self.assertNotIn('rows',result['payouts'])
        self.assertEqual(result['charges']['state'],'not_connected')
    def test_penalty_and_deduction_are_kept_by_type(self):
        fine=self.row(); fine.update(rrdId=8,sellerOperName='Штраф',docTypeName='',quantity=0,penalty='12.50',deduction='0',
                                     bonusTypeName='Штраф МП. Невыполненный заказ',srid='SECRET-ORDER')
        hold=self.row(); hold.update(rrdId=9,sellerOperName='Удержание',docTypeName='',quantity=0,penalty='0',deduction='-3.20',
                                     bonusTypeName='Удержание за продвижение')
        other=self.row(); other.update(rrdId=10,penalty='1.00',deduction='0',bonusTypeName='Корректировка')
        result=self.calc([self.row(),fine,hold,other])
        rows=result['charges']['rows']
        self.assertEqual([(r['operation'], r['type'], r['penaltyKop'], r['deductionKop']) for r in rows],
                         [('Продажа','Корректировка',100,0),
                          ('Удержание','Удержание за продвижение',0,-320),
                          ('Штраф','Штраф МП. Невыполненный заказ',1250,0)])
        dumped=json.dumps(result['charges'])
        self.assertNotIn('SECRET-ORDER', dumped)
        self.assertNotIn('rrdId', dumped)
    def test_fractional_penalty_fails(self):
        bad=self.row(); bad.update(rrdId=8,sellerOperName='Штраф',docTypeName='',penalty='0.001',deduction='0')
        with self.assertRaises(sync.SyncError):
            self.calc([bad])

if __name__=='__main__': unittest.main()
