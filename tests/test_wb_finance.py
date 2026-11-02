import importlib.util
import unittest
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
    def test_amount_precision(self):
        self.assertEqual(sync.kopecks('0.01'),1)
        for value in ['-1','NaN','0.001']:
            with self.assertRaises(sync.SyncError): sync.kopecks(value)

if __name__=='__main__': unittest.main()
