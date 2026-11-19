#!/usr/bin/env python3
"""Отчёт Яндекс Метрики 99820405 за два последних завершённых дня.

Токен читается из переменной YANDEX_METRIKA_TOKEN. В аргументы командной
строки и в отчёт он не записывается. Повторный запуск за те же даты не
создаёт второй файл.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

COUNTER_ID = 99820405
MOSCOW = timezone(timedelta(hours=3))
EPOCH = date(2026, 1, 1)
API = "https://api-metrika.yandex.net"
SOURCE_ORDER = ("yandex", "social", "referral", "direct", "utm", "other_search", "unknown")
SOURCE_LABELS = {
    "yandex": "Яндекс",
    "social": "Соцсети",
    "referral": "Переходы с других сайтов",
    "direct": "Прямые визиты",
    "utm": "Кампании с UTM",
    "other_search": "Другие поисковые системы",
    "unknown": "Неизвестный источник",
}
PAGES = (
    ("home", "Главная", "ym:pv:URLPath=='/'"),
    ("catalog", "Каталог", "ym:pv:URLPath=@'/professional-hair-care'"),
    ("sinko", "SINKO STYLING", "ym:pv:URLPath=@'/sinko-styling'"),
    ("product", "Карточки товаров", "ym:pv:URLPath=@'/product/'"),
    ("contacts", "Контакты", "ym:pv:URLPath=@'/contacs'"),
)
FUNNEL = (
    ("price_block_view", "Увидели блок прайса"),
    ("price_form_start", "Начали форму"),
    ("price_form_success", "Отправили заявку"),
)
GOAL_CATALOG = (
    ("price_block_view", "Прайс: блок появился в видимой области"),
    ("price_cta_click", "Прайс: нажатие «Получить прайс»"),
    ("price_form_start", "Прайс: первое заполнение формы № 3"),
    ("price_form_success", "Прайс: Fluent Forms подтвердил заявку"),
    ("price_download_click", "Прайс: клик по скачиванию файла"),
    ("contacts_view", "Контакты: просмотр /contacs/"),
    ("contact_phone_click", "Контакт: телефон"),
    ("contact_email_click", "Контакт: почта"),
    ("contact_messenger_click", "Контакт: мессенджер"),
) + tuple(
    (f"engage_{seconds}_{page}", f"Оценка вовлечённости: {seconds} с видимой вкладки, {page}")
    for seconds in (15, 30, 60)
    for page, _label, _filter in PAGES
)
PAGE_LABEL = {page: label for page, label, _filter in PAGES}
MESSENGER_NOTE = (
    "Учёта заявок из мессенджера на сайте нет. В форме прайса и в журнале прямых заказов "
    "нет поля «Откуда узнали о нас?». Имеет смысл добавить один вариант «Рекомендация мастера». "
    "Такие заявки не складываются с визитами на сайт."
)


def moscow_today(now: datetime | None = None) -> date:
    current = now or datetime.now(MOSCOW)
    if current.tzinfo is None:
        current = current.replace(tzinfo=MOSCOW)
    return current.astimezone(MOSCOW).date()


def pair_bounds(index: int) -> tuple[date, date]:
    start = EPOCH + timedelta(days=index * 2)
    return start, start + timedelta(days=1)


def pair_index(day: date) -> int:
    return (day - EPOCH).days // 2


def latest_closed_pair(today: date) -> tuple[date, date]:
    index = pair_index(today)
    start, end = pair_bounds(index)
    if end >= today:
        start, end = pair_bounds(index - 1)
    if end >= today:
        raise ValueError("Нет закрытого двухдневного окна")
    return start, end


def due_pairs(today: date, existing_ids: set[str]) -> list[tuple[date, date]]:
    """Первый запуск берёт только последнее закрытое окно. Дальше — пропущенные окна по порядку."""
    latest = latest_closed_pair(today)
    if not existing_ids:
        return [latest]
    known = sorted(existing_ids)
    last_start = date.fromisoformat(known[-1].split("_")[0])
    index = pair_index(last_start) + 1
    due = []
    while True:
        start, end = pair_bounds(index)
        if end >= today or (start, end) > latest:
            break
        identifier = f"{start.isoformat()}_{end.isoformat()}"
        if identifier not in existing_ids:
            due.append((start, end))
        index += 1
    return due


def period_id(start: date, end: date) -> str:
    return f"{start.isoformat()}_{end.isoformat()}"


def classify_source(traffic: str, engine: str, utm: str) -> str:
    utm_text = (utm or "").strip()
    if utm_text and utm_text.lower() not in {"null", "(none)", "(not set)", "не определено"}:
        return "utm"
    source = (traffic or "").strip().lower()
    search = (engine or "").strip().lower()
    if source == "organic" and search in {"yandex", "яндекс", "yandex.ru"}:
        return "yandex"
    if source in {"social", "messenger"}:
        return "social"
    if source == "referral":
        return "referral"
    if source == "direct":
        return "direct"
    if source == "organic":
        return "other_search"
    return "unknown"


def sum_sources(rows: list[dict]) -> list[dict]:
    totals = {key: 0 for key in SOURCE_ORDER}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        totals[classify_source(row.get("traffic", ""), row.get("engine", ""), row.get("utm", ""))] += int(row.get("visits") or 0)
    return [{"id": key, "label": SOURCE_LABELS[key], "visits": totals[key]} for key in SOURCE_ORDER]


def ordered_funnel(events: list[dict]) -> list[dict]:
    """Считает визиты, где этапы случились в заданном порядке по времени."""
    by_visit: dict[str, list[tuple[str, str]]] = {}
    for event in events:
        visit = str(event.get("visit_id") or "")
        goal = event.get("goal")
        moment = str(event.get("time") or "")
        if visit and goal and moment:
            by_visit.setdefault(visit, []).append((moment, goal))
    counts = {goal: 0 for goal, _label in FUNNEL}
    for items in by_visit.values():
        items.sort()
        cursor = ""
        for goal, _label in FUNNEL:
            found = next((moment for moment, name in items if name == goal and moment > cursor), None)
            if found is None:
                break
            counts[goal] += 1
            cursor = found
    stages = []
    previous = None
    for goal, label in FUNNEL:
        visits = counts[goal]
        share = None if previous in (None, 0) else round(visits / previous, 4)
        stages.append({"id": goal, "label": label, "visits": visits, "shareOfPrevious": share})
        previous = visits
    return stages


def page_sequences(hits: list[dict], limit: int = 3) -> list[dict]:
    grouped: dict[str, list[tuple[str, str]]] = {}
    for hit in hits:
        visit = str(hit.get("visit_id") or "")
        path = str(hit.get("path") or "")
        moment = str(hit.get("time") or "")
        if visit and path and moment and "?" not in path and "#" not in path:
            grouped.setdefault(visit, []).append((moment, path.split("?")[0]))
    counts: dict[tuple[str, ...], int] = {}
    for items in grouped.values():
        items.sort()
        paths = []
        for _moment, path in items:
            if not paths or paths[-1] != path:
                paths.append(path)
        for length in (2, 3):
            for index in range(0, len(paths) - length + 1):
                key = tuple(paths[index:index + length])
                counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    return [{"path": list(path), "visits": visits} for path, visits in ranked]


def _record(value) -> dict:
    """Ответ Метрики для итогов — список чисел. Словарём считаем только объект."""
    return value if isinstance(value, dict) else {}


def _number(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def _delta_line(current, previous, noun: str) -> str:
    if current is None or previous is None:
        return f"Сравнение «{noun}» недоступно."
    delta = current - previous
    if delta == 0:
        change = "столько же"
    elif delta > 0:
        change = f"на {delta} больше"
    else:
        change = f"на {abs(delta)} меньше"
    return f"{noun}: {current} против {previous} за предыдущие два дня, {change}."


def conclusions(report: dict) -> list[str]:
    lines = []
    current = (report.get("totals") or {}).get("visits")
    previous = (report.get("previousTotals") or {}).get("visits")
    if current is None or previous is None:
        lines.append("Сравнение визитов недоступно: итог API не пришёл. Нулевыми визитами это не заменяется.")
    else:
        lines.append(_delta_line(current, previous, "Визиты").rstrip(".") + (
            ". Трафик небольшой, рядом с любой долей смотрите абсолютное число." if current < 30 else "."
        ))
    funnel = report.get("funnel") or {}
    if funnel.get("mode") == "ordered":
        stages = funnel.get("stages") or []
        biggest = None
        for index in range(1, len(stages)):
            before = stages[index - 1].get("visits")
            after = stages[index].get("visits")
            if before is None or after is None:
                continue
            drop = before - after
            if biggest is None or drop > biggest[0]:
                biggest = (drop, stages[index - 1], stages[index])
        if biggest and biggest[0] > 0:
            lines.append(
                f"Самый большой отвал по одним и тем же визитам: «{biggest[1]['label']}» {biggest[1]['visits']} → "
                f"«{biggest[2]['label']}» {biggest[2]['visits']}, минус {biggest[0]}."
            )
        elif biggest:
            lines.append("По тем же визитам между этапами воронки отвала нет.")
    else:
        lines.append("Порядок этапов по одним визитам API не отдал. Отдельные итоги целей на конверсию воронки не делю.")
    success = _goal_visits(report, "price_form_success")
    views = _goal_visits(report, "price_block_view")
    starts = _goal_visits(report, "price_form_start")
    if report.get("apiError"):
        lines.append("Сначала проверить токен и права metrika:read в кабинете Яндекс Метрики: отчёт без них не собирается.")
    elif success == 0 and (views or 0) > 0:
        lines.append(
            f"Блок прайса отмечен в {views} визитах, подтверждённых заявок 0. Первым проверить отправку формы № 3 и согласия."
        )
    elif starts is not None and success is not None and starts > success:
        lines.append(
            f"Форму начали в {starts} визитах, заявку подтвердили в {success}. Первым проверить ошибки заполнения и ответ Fluent Forms."
        )
    elif success is None:
        lines.append("Цели прайса в счётчике ещё не найдены. Первым создать цели с идентификаторами из списка и поставить плагин на WordPress.")
    else:
        lines.append(f"Подтверждённых заявок прайса {success}. Клики по кнопке и по файлу смотреть отдельными строками, не как шаг воронки.")
    return lines[:3]


def _goal_visits(report: dict, goal: str):
    for stage in (report.get("funnel") or {}).get("stages") or []:
        if stage.get("id") == goal:
            return stage.get("visits")
    for extra in (report.get("funnel") or {}).get("separate") or []:
        if extra.get("id") == goal:
            return extra.get("visits")
    return None


def build_report(period: tuple[date, date], previous: tuple[date, date], current: dict, prior: dict, logs: dict | None, goal_status: dict) -> dict:
    current = current if isinstance(current, dict) else {}
    prior = prior if isinstance(prior, dict) else {}
    current_totals = _record(current.get("totals"))
    prior_totals = _record(prior.get("totals"))
    source_rows = sum_sources(current.get("sources") or [])
    prior_sources = {row["id"]: row["visits"] for row in sum_sources(prior.get("sources") or [])}
    for row in source_rows:
        row["previous"] = prior_sources.get(row["id"], 0)
    source_sum = sum(row["visits"] for row in source_rows)
    total_visits = _number(current_totals.get("visits"))
    source_gap = None if total_visits is None else int(total_visits) - source_sum
    logs = logs or {}
    events = logs.get("events")
    ordered = ordered_funnel(events) if events is not None else None
    sequences = page_sequences(logs.get("hits") or []) if logs.get("hits") is not None else None
    funnel_mode = "ordered" if ordered is not None else "separate_goal_totals"
    stages = []
    if ordered is not None:
        stages = ordered
        funnel_note = "Этапы посчитаны по одним и тем же визитам и только в порядке: увидели блок, затем начали форму, затем заявка."
    else:
        funnel_note = "API отдал отдельные итоги целей. Долю одного итога от другого как конверсию воронки не считаю."
        for goal, label in FUNNEL:
            found = _record(goal_status.get(goal))
            value = _record(_record(current.get("goals")).get(goal))
            stages.append({
                "id": goal,
                "label": label,
                "visits": None if not found.get("found") else value.get("visits"),
                "reaches": None if not found.get("found") else value.get("reaches"),
                "shareOfPrevious": None,
                "error": None if found.get("found") else "Цель в счётчике ещё не создана. Сбор не начат.",
            })
    separate = []
    for goal, label in (("price_cta_click", "Нажатие «Получить прайс»"), ("price_download_click", "Клик по скачиванию")):
        found = _record(goal_status.get(goal))
        value = _record(_record(current.get("goals")).get(goal))
        separate.append({
            "id": goal,
            "label": label if goal == "price_cta_click" else "Клик по скачиванию",
            "visits": None if not found.get("found") else value.get("visits"),
            "reaches": None if not found.get("found") else value.get("reaches"),
            "error": None if found.get("found") else "Цель в счётчике ещё не создана. Сбор не начат.",
            "note": "До формы можно дойти скроллом, поэтому клик по кнопке не входит в воронку." if goal == "price_cta_click"
            else "Сайт подтверждает только клик по ссылке на файл, не саму выдачу. Это не шаг воронки заявки.",
        })
    pages = []
    for page, label, _filter in PAGES:
        item = _record(_record(current.get("pages")).get(page))
        outcome = (logs.get("page_outcomes") or {}).get(page) if logs.get("page_outcomes") is not None else None
        pages.append({
            "id": page,
            "label": label,
            "visits": item.get("visits"),
            "pageviews": item.get("pageviews"),
            "reachedPrice": None if outcome is None else outcome.get("price"),
            "reachedContacts": None if outcome is None else outcome.get("contacts"),
            "note": "Сколько визитов с этой страницей затем дошли до заявки или контакта, по тем же визитам." if outcome is not None
            else "Визиты страницы и цели приходят разными итогами. Долю «дошли до прайса» из них не делю.",
        })
    engagement_rows = []
    for page, label, _filter in PAGES:
        views = _record(_record(current.get("pages")).get(page)).get("pageviews")
        row = {"page": label, "pageviews": views, "seconds": {}}
        for seconds in (15, 30, 60):
            goal = f"engage_{seconds}_{page}"
            found = _record(goal_status.get(goal))
            value = _record(_record(current.get("goals")).get(goal))
            reaches = None if not found.get("found") else value.get("reaches")
            share = None
            note = None
            if reaches is not None and views not in (None, 0):
                if reaches > views:
                    note = "Достижений больше, чем просмотров. Долю не делю, чтобы не получить конверсию выше 100%."
                else:
                    share = round(reaches / views, 4)
            row["seconds"][str(seconds)] = {
                "reaches": reaches,
                "shareOfPageviews": share,
                "error": note or (None if found.get("found") else "Цель видимой вкладки ещё не создана. Сбор не начат."),
            }
        engagement_rows.append(row)
    contacts = {}
    for goal, key in (
        ("contacts_view", "page"),
        ("contact_phone_click", "phone"),
        ("contact_email_click", "email"),
        ("contact_messenger_click", "messenger"),
    ):
        found = _record(goal_status.get(goal))
        value = _record(_record(current.get("goals")).get(goal))
        contacts[key] = {
            "id": goal,
            "visits": None if not found.get("found") else value.get("visits"),
            "reaches": None if not found.get("found") else value.get("reaches"),
            "error": None if found.get("found") else "Цель в счётчике ещё не создана. Сбор не начат.",
        }
    report = {
        "schemaVersion": 1,
        "sample": False,
        "counterId": COUNTER_ID,
        "id": period_id(*period),
        "period": {"start": period[0].isoformat(), "end": period[1].isoformat()},
        "previousPeriod": {"start": previous[0].isoformat(), "end": previous[1].isoformat()},
        "generatedAt": datetime.now(MOSCOW).isoformat(timespec="seconds"),
        "totals": current_totals,
        "previousTotals": prior_totals,
        "sources": source_rows,
        "sourceGap": source_gap,
        "entrances": current.get("entrances") or [],
        "sequences": {
            "available": sequences is not None,
            "rows": sequences or [],
            "reason": None if sequences is not None else "Журнал просмотров Метрики недоступен, типичные последовательности не восстанавливаю.",
        },
        "pages": pages,
        "visitDuration": {
            "label": "Средняя длительность визита",
            "seconds": current_totals.get("avgDurationSeconds"),
            "previousSeconds": prior_totals.get("avgDurationSeconds"),
        },
        "engagement": {
            "label": "Оценка вовлечённости",
            "note": "Секунды видимой вкладки на целевой странице. Это не длительность визита и с ней не складывается.",
            "rows": engagement_rows,
        },
        "funnel": {
            "mode": funnel_mode,
            "note": funnel_note,
            "stages": stages,
            "separate": separate,
        },
        "contacts": contacts,
        "errors": list(current.get("errors") or []),
        "apiError": current.get("apiError"),
    }
    report["conclusions"] = conclusions(report)
    return report


def public_document(history: list[dict], notice: str, registry: dict) -> dict:
    clean = []
    for report in history:
        if report.get("sample"):
            raise ValueError("Тестовый отчёт нельзя публиковать как статистику сайта")
        blob = json.dumps(report, ensure_ascii=False)
        if "YANDEX_METRIKA_TOKEN" in blob or "OAuth " in blob:
            raise ValueError("В отчёт попал секрет")
        clean.append(report)
    return {
        "schemaVersion": 1,
        "counterId": COUNTER_ID,
        "live": bool(clean),
        "notice": notice,
        "goals": [{"id": goal, "label": label, "collectionStart": (registry.get(goal) or {}).get("createdOn")} for goal, label in GOAL_CATALOG],
        "messenger": {"tracked": False, "note": MESSENGER_NOTE},
        "history": clean,
    }


def save_history(directory: Path, report: dict) -> dict:
    if report.get("sample"):
        raise ValueError("Тестовый отчёт в историю сайта не пишется")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{report['id']}.json"
    if path.exists():
        return {"written": False, "path": str(path), "reason": "Такой период уже сохранён"}
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"written": True, "path": str(path)}


def load_history(directory: Path) -> list[dict]:
    if not directory.exists():
        return []
    reports = []
    for path in sorted(directory.glob("*.json")):
        reports.append(json.loads(path.read_text(encoding="utf-8")))
    return reports


class MetrikaClient:
    def __init__(self, token: str, opener=None, counter: int = COUNTER_ID):
        self.token = token
        self.counter = counter
        self.opener = opener or urllib.request.urlopen

    def _request(self, method: str, url: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Authorization", f"OAuth {self.token}")
        if body is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with self.opener(request, timeout=40) as response:
                raw = response.read().decode("utf-8")
                status = getattr(response, "status", 200)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:500]
            raise RuntimeError(f"Метрика ответила {error.code}: {detail}") from None
        if status >= 400:
            raise RuntimeError(f"Метрика ответила {status}: {raw[:500]}")
        return json.loads(raw) if raw else {}

    def list_goals(self) -> list[dict]:
        payload = self._request("GET", f"{API}/management/v1/counter/{self.counter}/goals")
        return payload.get("goals") or []

    def create_goal(self, identifier: str, name: str) -> dict:
        payload = self._request("POST", f"{API}/management/v1/counter/{self.counter}/goals", {
            "goal": {
                "name": name[:255],
                "type": "action",
                "conditions": [{"type": "exact", "url": identifier}],
            }
        })
        return payload.get("goal") or payload

    def stat(self, metrics: list[str], date1: str, date2: str, dimensions: list[str] | None = None, filters: str | None = None) -> dict:
        params = {
            "ids": str(self.counter),
            "metrics": ",".join(metrics),
            "date1": date1,
            "date2": date2,
            "accuracy": "full",
            "limit": "10000",
            "lang": "ru",
        }
        if dimensions:
            params["dimensions"] = ",".join(dimensions)
        if filters:
            params["filters"] = filters
        url = f"{API}/stat/v1/data?{urllib.parse.urlencode(params)}"
        return self._request("GET", url)


def goal_identifier(goal: dict) -> str:
    for condition in goal.get("conditions") or []:
        url = str(condition.get("url") or "")
        if url:
            return url
    return ""


def sync_goals(client: MetrikaClient, registry: dict, today: date) -> dict:
    remote = client.list_goals()
    found = {}
    for goal in remote:
        identifier = goal_identifier(goal)
        if identifier:
            found[identifier] = goal.get("id")
    for identifier, name in GOAL_CATALOG:
        if identifier in found:
            registry.setdefault(identifier, {"metrikaId": found[identifier], "createdOn": None, "existed": True})
            registry[identifier]["metrikaId"] = found[identifier]
            continue
        try:
            created = client.create_goal(identifier, name)
        except RuntimeError as error:
            registry[identifier] = {"metrikaId": None, "createdOn": None, "error": str(error), "found": False}
            continue
        registry[identifier] = {"metrikaId": created.get("id"), "createdOn": today.isoformat(), "existed": False}
        found[identifier] = created.get("id")
    status = {}
    for identifier, _name in GOAL_CATALOG:
        item = registry.get(identifier) or {}
        status[identifier] = {"found": bool(item.get("metrikaId")), "id": item.get("metrikaId"), "createdOn": item.get("createdOn"), "error": item.get("error")}
    return status


def _dim(dimensions: list, index: int) -> str:
    if not isinstance(dimensions, list) or index >= len(dimensions):
        return ""
    item = dimensions[index] or {}
    if not isinstance(item, dict):
        return "" if item in (None, "null") else str(item)
    value = item.get("id")
    if value in (None, "", "null"):
        value = item.get("name")
    if value in (None, "null"):
        return ""
    return str(value)


def _stat_object(body, label: str) -> dict:
    if isinstance(body, dict):
        return body
    raise RuntimeError(f"Метрика отдала список вместо объекта «{label}». Итоги не разобраны.")


def _metric_list(body: dict, label: str) -> list:
    raw = body.get("totals")
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    raise RuntimeError(f"Поле totals в ответе «{label}» не список чисел.")


def collect_period(client: MetrikaClient, start: date, end: date, goal_status: dict) -> dict:
    date1, date2 = start.isoformat(), end.isoformat()
    errors = []
    summary_body = _stat_object(
        client.stat(["ym:s:users", "ym:s:visits", "ym:s:pageviews", "ym:s:avgVisitDurationSeconds"], date1, date2),
        "итоги визитов",
    )
    totals_row = _metric_list(summary_body, "итоги визитов") or [None, None, None, None]
    summary = {
        "users": totals_row[0] if len(totals_row) > 0 else None,
        "visits": totals_row[1] if len(totals_row) > 1 else None,
        "pageviews": totals_row[2] if len(totals_row) > 2 else None,
        "avgDurationSeconds": totals_row[3] if len(totals_row) > 3 else None,
        "sampled": bool(summary_body.get("sampled")),
    }
    source_body = _stat_object(client.stat(
        ["ym:s:visits"], date1, date2,
        ["ym:s:lastTrafficSource", "ym:s:lastSearchEngineRoot", "ym:s:lastUTMCampaign"],
    ), "источники")
    sources = []
    for row in source_body.get("data") or []:
        if not isinstance(row, dict):
            errors.append("Строка источника в ответе Метрики не объект.")
            continue
        dimensions = row.get("dimensions") or []
        metrics = row.get("metrics") if isinstance(row.get("metrics"), list) else [0]
        sources.append({
            "traffic": _dim(dimensions, 0),
            "engine": _dim(dimensions, 1),
            "utm": _dim(dimensions, 2),
            "visits": metrics[0] if metrics else 0,
        })
    entrance_body = _stat_object(client.stat(["ym:s:visits"], date1, date2, ["ym:s:startURL"]), "страницы входа")
    entrances = []
    for row in (entrance_body.get("data") or [])[:8]:
        if not isinstance(row, dict):
            errors.append("Строка страницы входа в ответе Метрики не объект.")
            continue
        dimensions = row.get("dimensions") if isinstance(row.get("dimensions"), list) else [{}]
        first = dimensions[0] if dimensions else {}
        url = first.get("name") if isinstance(first, dict) else ""
        metrics = row.get("metrics") if isinstance(row.get("metrics"), list) else [0]
        entrances.append({"url": str(url or "").split("?")[0], "visits": metrics[0] if metrics else 0})
    pages = {}
    for page, _label, filters in PAGES:
        try:
            body = _stat_object(client.stat(["ym:s:visits", "ym:s:pageviews"], date1, date2, filters=filters), page)
            metrics = _metric_list(body, page) or [None, None]
            pages[page] = {"visits": metrics[0] if metrics else None, "pageviews": metrics[1] if len(metrics) > 1 else None}
        except RuntimeError as error:
            errors.append(f"{page}: {error}")
            pages[page] = {"visits": None, "pageviews": None, "error": str(error)}
    goals = {}
    pairs = [(identifier, item["id"]) for identifier, item in goal_status.items() if isinstance(item, dict) and item.get("found") and item.get("id")]
    for offset in range(0, len(pairs), 10):
        chunk = pairs[offset:offset + 10]
        metrics = []
        for _identifier, goal_id in chunk:
            metrics.append(f"ym:s:goal{goal_id}visits")
            metrics.append(f"ym:s:goal{goal_id}reaches")
        try:
            body = _stat_object(client.stat(metrics, date1, date2), "цели")
            goal_totals = _metric_list(body, "цели")
        except RuntimeError as error:
            errors.append(str(error))
            continue
        for index, (identifier, _goal_id) in enumerate(chunk):
            goals[identifier] = {
                "visits": goal_totals[index * 2] if len(goal_totals) > index * 2 else None,
                "reaches": goal_totals[index * 2 + 1] if len(goal_totals) > index * 2 + 1 else None,
            }
    return {"totals": summary, "sources": sources, "entrances": entrances, "pages": pages, "goals": goals, "errors": errors}


def run(client, today: date, history_dir: Path, publish_path: Path, registry_path: Path, notice_without_token: str | None = None) -> dict:
    registry = {}
    if registry_path.exists():
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    history = load_history(history_dir)
    if client is None:
        document = public_document(history, notice_without_token or (
            "Просмотры уже идут в счётчик 99820405. Отчёт по API не собран: секрет YANDEX_METRIKA_TOKEN не задан. "
            "Цифры посещений здесь не подставлены."
        ), registry)
        publish_path.parent.mkdir(parents=True, exist_ok=True)
        if not publish_path.exists():
            publish_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {"published": False, "reason": "no_token", "due": []}
    goal_status = sync_goals(client, registry, today)
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    existing = {report["id"] for report in history}
    due = due_pairs(today, existing)
    written = []
    for start, end in due:
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=1)
        try:
            current = collect_period(client, start, end, goal_status)
            prior = collect_period(client, previous_start, previous_end, goal_status)
        except RuntimeError as error:
            document = public_document(history, f"Отчёт за {start.isoformat()}–{end.isoformat()} не сохранён: {error}", registry)
            publish_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return {"published": False, "reason": "api_error", "error": str(error), "due": [period_id(start, end) for start, end in due]}
        report = build_report((start, end), (previous_start, previous_end), current, prior, None, goal_status)
        result = save_history(history_dir, report)
        if result["written"]:
            history.append(report)
            written.append(result["path"])
    notice = "Сводка посещений сайта. Имена, телефоны, почта и параметры форм сюда не попадают."
    if not history:
        notice = "Токен есть, но закрытое двухдневное окно ещё не сохранено."
    document = public_document(history, notice, registry)
    publish_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"published": True, "written": written, "due": [period_id(start, end) for start, end in due]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Собрать двухдневный отчёт Метрики")
    parser.add_argument("--now", default="", help="Момент запуска, ISO с часовым поясом. По умолчанию текущее московское время.")
    parser.add_argument("--history", default="site-analytics/history")
    parser.add_argument("--publish", default="site-analytics/published.json")
    parser.add_argument("--registry", default="site-analytics/goal-registry.json")
    args = parser.parse_args(argv)
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(MOSCOW)
    today = moscow_today(now)
    token = os.environ.get("YANDEX_METRIKA_TOKEN", "").strip()
    root = Path.cwd()
    client = MetrikaClient(token) if token else None
    if token:
        print("Токен прочитан из окружения, в отчёт не записывается.", file=sys.stderr)
    result = run(client, today, root / args.history, root / args.publish, root / args.registry)
    print(json.dumps({"today": today.isoformat(), **{key: result[key] for key in result if key != "error"}, "error": result.get("error")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
