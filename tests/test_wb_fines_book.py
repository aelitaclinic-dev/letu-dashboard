import json
import unittest


def load_dashboard():
    with open("data.js", encoding="utf-8") as handle:
        text = handle.read()
    return json.loads(text.split("=", 1)[1].strip().rstrip(";"))


class FineBookTests(unittest.TestCase):
    def test_ip_expenses_match_the_line_report(self):
        book = load_dashboard()["businessExpenses"]
        with open("wb-finance.json", encoding="utf-8") as handle:
            finance = json.load(handle)
        charges = finance["charges"]["rows"]
        booked = [row for row in book["records"] if str(row["id"]).startswith("wb-")]
        self.assertTrue(booked)
        self.assertTrue(any(item["id"] == "wb-charges" for item in book["categories"]))
        penalty = sum(row["penaltyKop"] for row in charges)
        withheld = sum(row["deductionKop"] for row in charges if row["deductionKop"] > 0)
        compensation = sum(row["deductionKop"] for row in charges if row["deductionKop"] < 0)
        self.assertEqual(sum(row["amountKop"] for row in booked if row["id"].startswith("wb-penalty-")), penalty)
        self.assertEqual(sum(row["amountKop"] for row in booked if not row["id"].startswith("wb-penalty-")), withheld)
        self.assertLess(compensation, 0)
        self.assertNotIn(str(abs(compensation)), "".join(row["comment"] for row in booked))
        for row in booked:
            self.assertEqual(row["entity"], "ip")
            self.assertEqual(row["payerEntity"], "ip")
            self.assertEqual(row["beneficiaryEntity"], "ip")
            self.assertEqual(row["channelScope"], "wb-ip")
            self.assertEqual(row["category"], "wb-charges")
            self.assertEqual(row["status"], "paid")
            self.assertEqual(row["allocationMethod"], "month")
            self.assertTrue(row["methodConfirmed"])
            self.assertEqual(row["needs"], [])
            self.assertGreater(row["amountKop"], 0)
            self.assertTrue(row["paidMonth"].startswith("2026-"))
