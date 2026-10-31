import importlib.util
import unittest
spec=importlib.util.spec_from_file_location('returns','scripts/wb_returns_sync.py')
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
class ReturnsTests(unittest.TestCase):
    def row(self): return dict(srid='PRIVATE1',shkId=123,orderDt='2026-03-21',returnStatus='В пути в пвз',returnType='Возврат продавцу',dstOfficeAddress='PRIVATE_ADDRESS')
    def test_unique_items_and_no_private_data(self):
        row=self.row();r=sync.aggregate([row,row],'2026-01-01','2026-11-01','2026-11-01',2)
        self.assertEqual(r['uniqueItems'],1);self.assertEqual(r['rows'][0]['qty'],1);self.assertNotIn('PRIVATE',str(r))
    def test_truncation_is_not_complete(self):
        with self.assertRaises(sync.ReturnError):sync.aggregate([self.row()],'2026-01-01','2026-11-01','2026-11-01',1001)
    def test_conflicting_status_fails(self):
        a=self.row();b=dict(a,returnStatus='Выдан продавцу')
        with self.assertRaises(sync.ReturnError):sync.aggregate([a,b],'2026-01-01','2026-11-01','2026-11-01',2)
