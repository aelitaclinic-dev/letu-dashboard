#!/usr/bin/env python3
"""Проверка отчёта Метрики на фиктивных ответах. Это не статистика сайта."""

import json
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import metrika_report as report


class WindowsTest(unittest.TestCase):
    def test_last_closed_pair_on_19_november(self):
        today = date(2026, 11, 19)
        start, end = report.latest_closed_pair(today)
        self.assertEqual((start, end), (date(2026, 11, 17), date(2026, 11, 18)))
        previous_end = start.fromordinal(start.toordinal() - 1)
        previous_start = previous_end.fromordinal(previous_end.toordinal() - 1)
        self.assertEqual((previous_start, previous_end), (date(2026, 11, 15), date(2026, 11, 16)))

    def test_rerun_same_window_is_empty(self):
        today = date(2026, 11, 19)
        existing = {"2026-11-17_2026-11-18"}
        self.assertEqual(report.due_pairs(today, existing), [])

    def test_backfill_only_missing_closed_pairs(self):
        today = date(2026, 11, 21)
        due = report.due_pairs(today, {"2026-11-15_2026-11-16"})
        self.assertEqual(due, [
            (date(2026, 11, 17), date(2026, 11, 18)),
            (date(2026, 11, 19), date(2026, 11, 20)),
        ])

    def test_moscow_morning(self):
        moment = datetime(2026, 11, 19, 9, 0, tzinfo=report.MOSCOW)
        self.assertEqual(report.moscow_today(moment), date(2026, 11, 19))
        utc = datetime(2026, 11, 19, 0, 30, tzinfo=timezone.utc)
        self.assertEqual(report.moscow_today(utc), date(2026, 11, 19))


class SourcesTest(unittest.TestCase):
    def test_buckets_do_not_overlap(self):
        rows = [
            {"traffic": "organic", "engine": "yandex", "utm": "", "visits": 4},
            {"traffic": "organic", "engine": "yandex", "utm": "spring", "visits": 3},
            {"traffic": "organic", "engine": "google", "utm": "", "visits": 2},
            {"traffic": "social", "engine": "", "utm": "", "visits": 5},
            {"traffic": "messenger", "engine": "", "utm": "", "visits": 1},
            {"traffic": "referral", "engine": "", "utm": "", "visits": 6},
            {"traffic": "direct", "engine": "", "utm": "", "visits": 7},
            {"traffic": "undefined", "engine": "", "utm": "", "visits": 8},
        ]
        buckets = report.sum_sources(rows)
        self.assertEqual(sum(item["visits"] for item in buckets), 36)
        by_id = {item["id"]: item["visits"] for item in buckets}
        self.assertEqual(by_id["yandex"], 4)
        self.assertEqual(by_id["utm"], 3)
        self.assertEqual(by_id["other_search"], 2)
        self.assertEqual(by_id["social"], 6)
        self.assertEqual(by_id["referral"], 6)
        self.assertEqual(by_id["direct"], 7)
        self.assertEqual(by_id["unknown"], 8)


class FunnelTest(unittest.TestCase):
    def test_ordered_same_visit(self):
        events = [
            {"visit_id": "a", "time": "1", "goal": "price_block_view"},
            {"visit_id": "a", "time": "2", "goal": "price_form_start"},
            {"visit_id": "a", "time": "3", "goal": "price_form_success"},
            {"visit_id": "b", "time": "1", "goal": "price_form_success"},
            {"visit_id": "c", "time": "2", "goal": "price_block_view"},
            {"visit_id": "c", "time": "1", "goal": "price_form_start"},
        ]
        stages = report.ordered_funnel(events)
        self.assertEqual([item["visits"] for item in stages], [2, 1, 1])
        self.assertIsNone(stages[0]["shareOfPrevious"])
        self.assertEqual(stages[1]["shareOfPrevious"], 0.5)
        self.assertEqual(stages[2]["shareOfPrevious"], 1.0)

    def test_separate_totals_are_not_divided(self):
        status = {goal: {"found": True, "id": index + 1} for index, (goal, _label) in enumerate(report.GOAL_CATALOG)}
        current = {
            "totals": {"users": 3, "visits": 4, "pageviews": 9, "avgDurationSeconds": 42},
            "sources": [{"traffic": "direct", "engine": "", "utm": "", "visits": 4}],
            "pages": {"home": {"visits": 2, "pageviews": 2}},
            "goals": {"price_block_view": {"visits": 4, "reaches": 4}, "price_form_success": {"visits": 1, "reaches": 1}},
        }
        built = report.build_report(
            (date(2026, 11, 17), date(2026, 11, 18)),
            (date(2026, 11, 15), date(2026, 11, 16)),
            current, {"totals": {"visits": 2}, "sources": []}, None, status,
        )
        self.assertEqual(built["funnel"]["mode"], "separate_goal_totals")
        self.assertTrue(all(stage.get("shareOfPrevious") is None for stage in built["funnel"]["stages"]))
        self.assertIn("не считаю", built["funnel"]["note"])
        self.assertNotEqual(built["visitDuration"]["label"], built["engagement"]["label"])
        self.assertIn("не длительность визита", built["engagement"]["note"])
        self.assertTrue(any("4 против 2" in line for line in built["conclusions"]))

    def test_sequences_from_hits_only(self):
        rows = report.page_sequences([
            {"visit_id": "a", "time": "1", "path": "/"},
            {"visit_id": "a", "time": "2", "path": "/professional-hair-care"},
            {"visit_id": "a", "time": "3", "path": "/product/item?token=secret"},
        ])
        self.assertTrue(rows)
        self.assertNotIn("token", json.dumps(rows))


class PublishTest(unittest.TestCase):
    def test_sample_is_rejected(self):
        with self.assertRaises(ValueError):
            report.public_document([{"sample": True, "id": "x"}], "Тестовые данные, это не статистика сайта", {})

    def test_history_write_is_idempotent(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            payload = {"sample": False, "id": "2026-11-17_2026-11-18", "counterId": 99820405}
            first = report.save_history(folder, payload)
            second = report.save_history(folder, payload)
            self.assertTrue(first["written"])
            self.assertFalse(second["written"])
            self.assertEqual(len(list(folder.glob("*.json"))), 1)

    def test_no_token_does_not_invent_visits(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            publish = folder / "published.json"
            result = report.run(None, date(2026, 11, 19), folder / "history", publish, folder / "registry.json")
            self.assertEqual(result["reason"], "no_token")
            document = json.loads(publish.read_text(encoding="utf-8"))
            self.assertFalse(document["live"])
            self.assertEqual(document["history"], [])
            self.assertNotIn("visits", json.dumps(document["history"]))
            self.assertIn("не подставлены", document["notice"])
            self.assertFalse(document["messenger"]["tracked"])
            self.assertIn("Рекомендация мастера", document["messenger"]["note"])


class ClientTest(unittest.TestCase):
    def test_token_stays_out_of_the_url(self):
        seen = {}

        class Response:
            status = 200
            def read(self):
                return json.dumps({"totals": [1, 2, 3, 4], "data": [], "sampled": False}).encode()
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                return False

        def opener(request, timeout=0):
            seen["url"] = request.full_url
            seen["auth"] = request.get_header("Authorization")
            return Response()

        client = report.MetrikaClient("secret-token", opener=opener)
        body = client.stat(["ym:s:visits"], "2026-11-17", "2026-11-18")
        self.assertEqual(body["totals"][0], 1)
        self.assertNotIn("secret-token", seen["url"])
        self.assertEqual(seen["auth"], "OAuth secret-token")
        self.assertIn("ids=99820405", seen["url"])


if __name__ == "__main__":
    unittest.main()
