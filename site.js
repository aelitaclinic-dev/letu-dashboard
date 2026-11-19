/* Сводка посещений maat-impera.ru. Тестовые цифры сюда не подставляются. */
(function () {
  var CACHE = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char];
    });
  }

  function day(value) {
    return value ? esc(String(value).split("-").reverse().join(".")) : "нет даты";
  }

  function num(value) {
    if (value == null || value === "") return "нет данных";
    var number = Number(value);
    if (!isFinite(number)) return "нет данных";
    return esc(String(Math.round(number * 10) / 10)).replace(".", ",");
  }

  function duration(seconds) {
    if (seconds == null) return "нет данных";
    var total = Math.round(Number(seconds));
    if (!isFinite(total) || total < 0) return "нет данных";
    var minutes = Math.floor(total / 60);
    var rest = total % 60;
    return minutes + " мин " + rest + " с";
  }

  function share(value) {
    if (value == null) return "долю не считаю";
    return num(Number(value) * 100) + "%";
  }

  function missing(error) {
    return error ? "<p class='muted'>" + esc(error) + "</p>" : "";
  }

  function reportHtml(item) {
    if (item.sample) {
      return "<section class='panel'><h2>Тестовые данные</h2><p>Это не статистика сайта. Фиктивный отчёт на страницу не выводится.</p></section>";
    }
    var period = item.period || {};
    var previous = item.previousPeriod || {};
    var totals = item.totals || {};
    var sources = (item.sources || []).map(function (row) {
      return "<tr><td>" + esc(row.label) + "</td><td>" + num(row.visits) + "</td><td>" + num(row.previous) + "</td></tr>";
    }).join("");
    var entrances = (item.entrances || []).map(function (row) {
      return "<li>" + esc(row.url) + " — " + num(row.visits) + " визитов</li>";
    }).join("") || "<li>нет данных</li>";
    var sequences = item.sequences || {};
    var sequenceHtml = sequences.available
      ? ((sequences.rows || []).map(function (row) {
          return "<li>" + esc((row.path || []).join(" → ")) + " — " + num(row.visits) + " визитов</li>";
        }).join("") || "<li>Повторяющихся переходов в журнале нет.</li>")
      : "<li>" + esc(sequences.reason || "Последовательности недоступны.") + "</li>";
    var pages = (item.pages || []).map(function (row) {
      var reached = row.reachedPrice == null && row.reachedContacts == null
        ? esc(row.note || "")
        : "до заявки " + num(row.reachedPrice) + ", до контактов " + num(row.reachedContacts);
      return "<tr><td>" + esc(row.label) + "</td><td>" + num(row.visits) + "</td><td>" + num(row.pageviews) + "</td><td>" + reached + "</td></tr>";
    }).join("");
    var funnel = item.funnel || {};
    var stages = (funnel.stages || []).map(function (stage) {
      var extra = funnel.mode === "ordered" && stage.shareOfPrevious != null
        ? " (" + share(stage.shareOfPrevious) + " от предыдущего этапа, " + num(stage.visits) + " визитов)"
        : "";
      return "<li><b>" + esc(stage.label) + ".</b> " + (stage.visits == null ? "нет данных" : num(stage.visits) + " визитов") + extra + missing(stage.error) + "</li>";
    }).join("");
    var separate = (funnel.separate || []).map(function (row) {
      return "<li><b>" + esc(row.label) + ".</b> " + (row.visits == null ? "нет данных" : num(row.visits) + " визитов") + ". " + esc(row.note || "") + missing(row.error) + "</li>";
    }).join("");
    var engagement = ((item.engagement || {}).rows || []).map(function (row) {
      var cells = [15, 30, 60].map(function (seconds) {
        var point = (row.seconds || {})[String(seconds)] || {};
        if (point.error && point.reaches == null) return esc(point.error);
        var text = num(point.reaches);
        if (point.shareOfPageviews != null) text += " (" + share(point.shareOfPageviews) + " просмотров)";
        return text;
      });
      return "<tr><td>" + esc(row.page) + "</td><td>" + num(row.pageviews) + "</td><td>" + cells[0] + "</td><td>" + cells[1] + "</td><td>" + cells[2] + "</td></tr>";
    }).join("");
    var contacts = item.contacts || {};
    function contactLine(key, label) {
      var row = contacts[key] || {};
      return "<li><b>" + label + ".</b> " + (row.visits == null ? "нет данных" : num(row.visits) + " визитов, достижений " + num(row.reaches)) + missing(row.error) + "</li>";
    }
    var conclusions = (item.conclusions || []).map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("");
    var errors = (item.errors || []).map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("");
    var visitDuration = item.visitDuration || {};
    return "<article class='panel site-report'><p class='market-eyebrow'>ОКНО " + day(period.start) + "–" + day(period.end) + "</p>"
      + "<h3>Два дня против " + day(previous.start) + "–" + day(previous.end) + "</h3>"
      + "<div class='grid cards'>"
      + "<div class='card'><span class='label'>Посетители</span><div class='value'>" + num(totals.users) + "</div></div>"
      + "<div class='card'><span class='label'>Визиты</span><div class='value'>" + num(totals.visits) + "</div></div>"
      + "<div class='card'><span class='label'>Просмотры</span><div class='value'>" + num(totals.pageviews) + "</div></div>"
      + "</div>"
      + (totals.sampled ? "<p class='muted'>Метрика отдала выборку, не полный пересчёт.</p>" : "")
      + "<h3>Источники</h3><table class='site-table'><thead><tr><th>Источник</th><th>Визиты</th><th>Предыдущие два дня</th></tr></thead><tbody>" + sources + "</tbody></table>"
      + (item.sourceGap ? "<p class='muted'>Сумма источников расходится с итогом визитов на " + num(item.sourceGap) + ". Расхождение не прячу в «неизвестный источник».</p>" : "")
      + "<h3>Страницы входа</h3><ul>" + entrances + "</ul>"
      + "<h3>Последовательности страниц</h3><ul>" + sequenceHtml + "</ul>"
      + "<h3>Разделы</h3><table class='site-table'><thead><tr><th>Страница</th><th>Визиты</th><th>Просмотры</th><th>Прайс и контакты</th></tr></thead><tbody>" + pages + "</tbody></table>"
      + "<h3>" + esc(visitDuration.label || "Средняя длительность визита") + "</h3><p>" + duration(visitDuration.seconds) + ". За предыдущие два дня: " + duration(visitDuration.previousSeconds) + ".</p>"
      + "<h3>" + esc((item.engagement || {}).label || "Оценка вовлечённости") + "</h3><p class='muted'>" + esc((item.engagement || {}).note || "") + "</p>"
      + "<table class='site-table'><thead><tr><th>Страница</th><th>Просмотры</th><th>15 с</th><th>30 с</th><th>60 с</th></tr></thead><tbody>" + engagement + "</tbody></table>"
      + "<h3>Воронка прайса</h3><p class='muted'>" + esc(funnel.note || "") + "</p><ol>" + stages + "</ol>"
      + "<h3>Отдельно от воронки</h3><ul>" + separate + "</ul>"
      + "<h3>Контакты</h3><ul>" + contactLine("page", "Просмотр /contacs/") + contactLine("phone", "Телефон") + contactLine("email", "Почта") + contactLine("messenger", "Мессенджер") + "</ul>"
      + "<h3>Выводы</h3><ol>" + conclusions + "</ol>"
      + (errors ? "<h3>Ошибки API</h3><ul>" + errors + "</ul>" : "")
      + "</article>";
  }

  function html(documentData) {
    documentData = documentData || {};
    var goals = (documentData.goals || []).filter(function (goal) {
      return String(goal.id || "").indexOf("engage_") !== 0;
    }).map(function (goal) {
      var start = goal.collectionStart ? "сбор с " + day(goal.collectionStart) : "дата начала сбора не зафиксирована";
      return "<li><code>" + esc(goal.id) + "</code> — " + esc(goal.label) + ". " + start + "</li>";
    }).join("");
    var history = documentData.history || [];
    var reports = history.length
      ? history.slice().reverse().map(reportHtml).join("")
      : "<section class='market-empty-state'><div><h3>Отчёта с цифрами ещё нет</h3><p>" + esc(documentData.notice || "Данные API не подставлены.") + "</p></div></section>";
    var messenger = (documentData.messenger || {}).note || "";
    return "<section class='site-analytics'><div class='unit-heading'><div><h2>Сайт</h2><p class='lead'>maat-impera.ru · счётчик " + esc(documentData.counterId || "99820405") + ". Заявки из мессенджера с визитами не складываются.</p></div></div>"
      + reports
      + "<section class='panel'><h3>Цели, которые должен принимать счётчик</h3><ul>" + goals + "</ul>"
      + "<p class='muted'>Цели видимой вкладки на 15, 30 и 60 секунд тоже создаются. В таблице выше они подписаны как оценка вовлечённости.</p></section>"
      + "<section class='panel'><h3>Заявки не с сайта</h3><p>" + esc(messenger) + "</p></section></section>";
  }

  function render() {
    return html(CACHE);
  }

  window.SiteAnalytics = {
    render: render,
    renderData: html,
    load: function (data) { CACHE = data; }
  };

  var url = location.hostname === "aelitaclinic-dev.github.io"
    ? "https://raw.githubusercontent.com/aelitaclinic-dev/letu-dashboard/main/site-analytics/published.json"
    : "site-analytics/published.json";
  if (typeof fetch === "function") {
    fetch(url, {cache: "no-store"}).then(function (response) {
      return response.ok ? response.json() : null;
    }).then(function (data) {
      if (!data || data.schemaVersion !== 1 || data.counterId !== 99820405) return;
      if ((data.history || []).some(function (item) { return item.sample; })) return;
      CACHE = data;
      if ((location.hash || "").indexOf("#site") === 0 && typeof window.MaatDashboardRerender === "function") window.MaatDashboardRerender();
    }).catch(function () {});
  }
})();
