/* Публичная сводка Л’Этуаль. Цифры приходят из data.js, ключей здесь нет. */
(function () {
  const DATA = window.DASHBOARD;
  const NO_CASH = "Нет подтверждающих данных";
  const MISSING = "Нет данных";
  const FUTURE = "Период ещё не наступил";
  const MONTH_NAME = {
    "01": "Январь", "02": "Февраль", "03": "Март", "04": "Апрель",
    "05": "Май", "06": "Июнь", "07": "Июль", "08": "Август",
    "09": "Сентябрь", "10": "Октябрь", "11": "Ноябрь", "12": "Декабрь",
  };
  const SHORT_MONTH = {
    "01": "янв", "02": "фев", "03": "мар", "04": "апр", "05": "май", "06": "июн",
    "07": "июл", "08": "авг", "09": "сен", "10": "окт", "11": "ноя", "12": "дек",
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function money(kop) {
    if (kop == null) return MISSING;
    const sign = kop < 0 ? "−" : "";
    const abs = Math.abs(kop);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, "0");
    const groups = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    if (frac === "00") return sign + groups + " ₽";
    return sign + groups + "," + frac + " ₽";
  }

  function qty(value) {
    if (value == null) return MISSING;
    if (Number.isInteger(value)) return String(value);
    return String(value).replace(".", ",");
  }

  function dayText(value) {
    if (!value) return "";
    const parts = String(value).slice(0, 10).split("-");
    return parts[2] + "." + parts[1] + "." + parts[0];
  }

  function brandLabel(value) {
    return value ? value : "Бренд не указан";
  }

  function sumKop(rows, key, flag) {
    const nums = rows.filter(function (row) { return row[flag] && row[key] != null; }).map(function (row) { return row[key]; });
    if (!nums.length) return null;
    return nums.reduce(function (acc, item) { return acc + item; }, 0);
  }

  function sumQty(rows, key, flag) {
    const nums = rows.filter(function (row) { return row[flag] && row[key] != null; }).map(function (row) { return row[key]; });
    if (!nums.length) return null;
    return nums.reduce(function (acc, item) { return acc + item; }, 0);
  }

  function params() {
    const query = new URLSearchParams(location.search);
    let from = query.get("from") || "2026-01-01";
    let to = query.get("to") || "2026-10-28";
    const brand = query.get("brand") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      from = "2026-01-01";
      to = "2026-10-28";
    }
    return { from: from, to: to, brand: brand };
  }

  function screenMonths(from, to) {
    const chosen = [];
    DATA.months.forEach(function (row) {
      const useMovement = (row.movementState === "month" || row.movementState === "partial")
        && row.analyticsStart >= from && row.analyticsEnd <= to;
      const useFinance = (row.financeState === "month" || row.financeState === "partial")
        && row.financeStart >= from && row.financeEnd <= to;
      if (useMovement || useFinance) {
        const copy = Object.assign({}, row, { useMovement: useMovement, useFinance: useFinance });
        chosen.push(copy);
      }
    });
    return chosen;
  }

  function linesOf(row, brand) {
    return (row.lines || []).filter(function (line) { return !brand || line.brand === brand; });
  }

  function rollup(lines, keyName) {
    const map = new Map();
    lines.forEach(function (line) {
      const key = line[keyName];
      const current = map.get(key) || { key: key, orderedQty: 0, orderedKop: 0, deliveredQty: 0, deliveredKop: 0 };
      current.orderedQty += line.orderedQty;
      current.orderedKop += line.orderedKop;
      current.deliveredQty += line.deliveredQty;
      current.deliveredKop += line.deliveredKop;
      map.set(key, current);
    });
    return Array.from(map.values()).filter(function (item) {
      return item.orderedQty !== 0 || item.deliveredQty !== 0;
    }).sort(function (a, b) { return b.deliveredKop - a.deliveredKop || b.orderedKop - a.orderedKop; });
  }

  function movementFigures(chosen, brand) {
    const used = chosen.filter(function (row) { return row.useMovement; });
    if (!used.length) return null;
    const lines = [];
    used.forEach(function (row) { lines.push.apply(lines, linesOf(row, brand)); });
    if (brand && !lines.length) {
      return { orderedQty: 0, orderedKop: 0, deliveredQty: 0, deliveredKop: 0, products: [], checkedEmpty: true };
    }
    if (!brand) {
      return {
        orderedQty: sumQty(used, "orderedQty", "useMovement"),
        orderedKop: sumKop(used, "orderedKop", "useMovement"),
        deliveredQty: sumQty(used, "deliveredQty", "useMovement"),
        deliveredKop: sumKop(used, "deliveredKop", "useMovement"),
        products: rollup(lines.map(function (line) {
          return Object.assign({}, line, { warehouse: line.article + "\0" + line.brand + "\0" + line.name });
        }), "warehouse").map(function (item) {
          const parts = item.key.split("\0");
          return { article: parts[0], brand: parts[1], name: parts[2], orderedQty: item.orderedQty, orderedKop: item.orderedKop, deliveredQty: item.deliveredQty, deliveredKop: item.deliveredKop };
        }),
        checkedEmpty: false,
      };
    }
    const products = rollup(lines.map(function (line) {
      return Object.assign({}, line, { group: line.article + "\0" + line.brand + "\0" + line.name });
    }), "group").map(function (item) {
      const parts = item.key.split("\0");
      return { article: parts[0], brand: parts[1], name: parts[2], orderedQty: item.orderedQty, orderedKop: item.orderedKop, deliveredQty: item.deliveredQty, deliveredKop: item.deliveredKop };
    });
    return {
      orderedQty: products.reduce(function (acc, item) { return acc + item.orderedQty; }, 0),
      orderedKop: products.reduce(function (acc, item) { return acc + item.orderedKop; }, 0),
      deliveredQty: products.reduce(function (acc, item) { return acc + item.deliveredQty; }, 0),
      deliveredKop: products.reduce(function (acc, item) { return acc + item.deliveredKop; }, 0),
      products: products,
      checkedEmpty: false,
    };
  }

  function windowPhrase(rows, flag, startKey, endKey) {
    const used = rows.filter(function (row) { return row[flag]; });
    if (!used.length) return "файла внутри выбранных дат нет";
    return dayText(used[0][startKey]) + "–" + dayText(used[used.length - 1][endKey]);
  }

  function partialNames(rows, flag, stateKey) {
    return rows.filter(function (row) { return row[flag] && row[stateKey] === "partial"; })
      .map(function (row) { return MONTH_NAME[row.month.slice(5)].toLowerCase(); });
  }

  function changeText(current, previous) {
    const rounded = Math.round((current - previous) / Math.abs(previous) * 100);
    if (rounded > 0) return "+" + rounded + "%";
    if (rounded < 0) return "−" + Math.abs(rounded) + "%";
    return "0%";
  }

  function delta(current, previous, stateKey, valueKey, favorable) {
    if (favorable == null) favorable = true;
    if (current[stateKey] === "future" || !previous) return "";
    const bothFull = current[stateKey] === "month" && previous[stateKey] === "month";
    if (bothFull && previous[valueKey] && current[valueKey] != null) {
      const text = changeText(current[valueKey], previous[valueKey]);
      if (text === "0%") return "<span class='delta'>" + esc(text) + "</span>";
      const rose = text.charAt(0) === "+";
      const good = favorable ? rose : !rose;
      return "<span class='delta " + (good ? "delta-up" : "delta-down") + "'>" + esc(text) + "</span>";
    }
    if (current[stateKey] === "partial" || previous[stateKey] === "partial") {
      return "<span class='delta'>не сравнивается</span>";
    }
    return "";
  }

  function missingCell(state) {
    return state === "future" ? FUTURE : MISSING;
  }

  function amountCell(row, stateKey, value) {
    if (row[stateKey] !== "month" && row[stateKey] !== "partial") return missingCell(row[stateKey]);
    return esc(money(value));
  }

  function countCell(row, stateKey, value) {
    if (row[stateKey] !== "month" && row[stateKey] !== "partial") return missingCell(row[stateKey]);
    return esc(qty(value));
  }

  function statusText(row) {
    const move = row.movementState;
    const fin = row.financeState;
    if (move === "future") return FUTURE;
    const loaded = function (state) { return state === "month" || state === "partial"; };
    if (!loaded(move) && !loaded(fin)) return MISSING;
    let head = "Есть отчёт исполнителя, файла заказов нет";
    if (move === "partial" || fin === "partial") head = "Неполный";
    else if (move === "month" && fin === "month") head = "Полный";
    else if (move === "month") head = "Есть файл заказов, отчёта исполнителя нет";
    if (loaded(move) && loaded(fin)) {
      const gap = row.deliveredKop - row.realizationKop;
      let tail = gap === 0 ? "Сверка доставки и реализации сходится." : "Доставка и реализация расходятся на " + money(gap) + ".";
      if (move === "partial" || fin === "partial") tail += " С полным соседним месяцем не сравнивается.";
      return head + ". " + tail;
    }
    return head;
  }

  function axisLabel(value) {
    if (Math.abs(value) >= 1000) return Math.round(value / 1000) + " тыс.";
    return String(Math.round(value));
  }

  function drawBars(caption, labels, series, note) {
    if (!labels.length) {
      return "<div class='chart-wrap'><h3 class='chart-title'>" + esc(caption) + "</h3><p>Нет данных. Нулевой столбик не поставлен.</p></div>";
    }
    const values = [];
    series.forEach(function (item) {
      item.values.forEach(function (value) { if (value != null) values.push(value); });
    });
    if (!values.length) {
      return "<div class='chart-wrap'><h3 class='chart-title'>" + esc(caption) + "</h3><p>Нет данных. Нулевой столбик не поставлен.</p></div>";
    }
    const peak = Math.max.apply(null, values) * 1.08 || 1;
    const width = 760;
    const height = 236;
    const padL = 56;
    const padR = 10;
    const padT = 12;
    const padB = 36;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const group = plotW / labels.length;
    const count = series.length;
    const barW = Math.min(16, group * 0.62 / count);
    let svg = "<div class='chart-wrap'><h3 class='chart-title'>" + esc(caption) + "</h3><svg class='chart' viewBox='0 0 " + width + " " + height + "' role='img'><title>" + esc(caption) + "</title>";
    for (let step = 0; step < 4; step += 1) {
      const value = peak * step / 3;
      const y = padT + plotH * (1 - value / peak);
      svg += "<line x1='" + padL + "' y1='" + y.toFixed(1) + "' x2='" + (width - padR) + "' y2='" + y.toFixed(1) + "' stroke='#E5DDD8'/>";
      svg += "<text x='" + (padL - 6) + "' y='" + (y + 4).toFixed(1) + "' text-anchor='end' font-size='11' fill='#6B6168'>" + esc(axisLabel(step === 0 ? 0 : value)) + "</text>";
    }
    const baseline = padT + plotH;
    labels.forEach(function (label, index) {
      const cx = padL + (index + 0.5) * group;
      svg += "<text x='" + cx.toFixed(1) + "' y='" + (height - 12) + "' text-anchor='middle' font-size='11' fill='#6B6168'>" + esc(label) + "</text>";
      const totalW = count * barW + (count - 1) * 3;
      const origin = cx - totalW / 2;
      series.forEach(function (item, seriesIndex) {
        const value = item.values[index];
        if (value == null) return;
        const barH = plotH * (value / peak);
        const x = origin + seriesIndex * (barW + 3);
        const y = baseline - barH;
        svg += "<rect x='" + x.toFixed(1) + "' y='" + y.toFixed(1) + "' width='" + barW.toFixed(1) + "' height='" + Math.max(barH, 0).toFixed(1) + "' rx='2' fill='" + item.color + "'><title>" + esc(item.tips[index]) + "</title></rect>";
      });
    });
    svg += "</svg><div class='legend'>";
    series.forEach(function (item) {
      svg += "<span><i class='swatch' style='background:" + item.color + "'></i>" + esc(item.name) + "</span>";
    });
    svg += "</div><p class='muted'>" + esc(note) + "</p></div>";
    return svg;
  }

  function drawLine(caption, labels, values, tips, note) {
    const nums = values.filter(function (value) { return value != null; });
    if (!labels.length || !nums.length) {
      return "<div class='chart-wrap'><h3 class='chart-title'>" + esc(caption) + "</h3><p>Нет данных. Линия от нуля не строится.</p></div>";
    }
    const peak = Math.max.apply(null, nums) * 1.08 || 1;
    const width = 760;
    const height = 236;
    const padL = 56;
    const padR = 10;
    const padT = 12;
    const padB = 36;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const group = plotW / labels.length;
    const baseline = padT + plotH;
    let svg = "<div class='chart-wrap'><h3 class='chart-title'>" + esc(caption) + "</h3><svg class='chart' viewBox='0 0 " + width + " " + height + "' role='img'><title>" + esc(caption) + "</title>";
    for (let step = 0; step < 4; step += 1) {
      const value = peak * step / 3;
      const y = padT + plotH * (1 - value / peak);
      svg += "<line x1='" + padL + "' y1='" + y.toFixed(1) + "' x2='" + (width - padR) + "' y2='" + y.toFixed(1) + "' stroke='#E5DDD8'/>";
      svg += "<text x='" + (padL - 6) + "' y='" + (y + 4).toFixed(1) + "' text-anchor='end' font-size='11' fill='#6B6168'>" + esc(axisLabel(step === 0 ? 0 : value)) + "</text>";
    }
    let segment = [];
    const circles = [];
    values.forEach(function (value, index) {
      const cx = padL + (index + 0.5) * group;
      svg += "<text x='" + cx.toFixed(1) + "' y='" + (height - 12) + "' text-anchor='middle' font-size='11' fill='#6B6168'>" + esc(labels[index]) + "</text>";
      if (value == null) {
        if (segment.length) circles.push(segment);
        segment = [];
        return;
      }
      const y = baseline - plotH * (value / peak);
      segment.push([cx, y, tips[index]]);
    });
    if (segment.length) circles.push(segment);
    circles.forEach(function (points) {
      if (points.length > 1) {
        const d = points.map(function (point, index) { return (index ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1); }).join(" ");
        svg += "<path d='" + d + "' fill='none' stroke='#5E5878' stroke-width='2'/>";
      }
      points.forEach(function (point) {
        svg += "<circle cx='" + point[0].toFixed(1) + "' cy='" + point[1].toFixed(1) + "' r='3.5' fill='#5E5878'><title>" + esc(point[2]) + "</title></circle>";
      });
    });
    svg += "</svg><div class='legend'><span><i class='swatch' style='background:#5E5878'></i>Накоплено начислений</span></div><p class='muted'>" + esc(note) + "</p></div>";
    return svg;
  }

  function orderChart(chosen, brand) {
    const labels = [];
    const ordered = [];
    const delivered = [];
    const orderedTips = [];
    const deliveredTips = [];
    chosen.forEach(function (row) {
      if (!row.useMovement) return;
      const label = SHORT_MONTH[row.month.slice(5)] + (row.movementState === "partial" ? "*" : "");
      let orderedKop = row.orderedKop;
      let deliveredKop = row.deliveredKop;
      if (brand) {
        const lines = linesOf(row, brand);
        orderedKop = lines.reduce(function (acc, line) { return acc + line.orderedKop; }, 0);
        deliveredKop = lines.reduce(function (acc, line) { return acc + line.deliveredKop; }, 0);
      }
      labels.push(label);
      ordered.push(orderedKop / 100);
      delivered.push(deliveredKop / 100);
      orderedTips.push(label + ": заказано " + money(orderedKop));
      deliveredTips.push(label + ": доставлено " + money(deliveredKop));
    });
    return drawBars(
      "Заказы и реализация по месяцам",
      labels,
      [
        { name: "Заказано", color: "#8C5E4A", values: ordered, tips: orderedTips },
        { name: "Доставлено / реализовано в аналитике", color: "#69465F", values: delivered, tips: deliveredTips },
      ],
      "Звёздочка — неполный месяц. Столбик есть только там, где загружен свой файл. Ноябрь и декабрь на графике не стоят: период ещё не наступил. Свод за 1 января–27 октября в эти столбики не входит."
    );
  }

  function receiptOf(month) {
    if (!DATA.receipts) return null;
    return DATA.receipts.months.filter(function (item) { return item.month === month; })[0] || null;
  }

  function receiptDelta(row, previous) {
    if (!previous || row.movementState === "future") return "";
    const now = receiptOf(row.month);
    const before = receiptOf(previous.month);
    if (!now || !before) return "";
    const comparable = row.financeState === "month" && previous.financeState === "month"
      && now.status === "matched" && before.status === "matched" && before.receivedKop;
    if (!comparable) {
      if (row.financeState === "partial" || previous.financeState === "partial" || now.status === "open" || before.status === "open") {
        return "<span class='delta'>не сравнивается</span>";
      }
      return "";
    }
    const text = changeText(now.receivedKop, before.receivedKop);
    if (text === "0%") return "<span class='delta'>" + esc(text) + "</span>";
    const rose = text.charAt(0) === "+";
    return "<span class='delta " + (rose ? "delta-up" : "delta-down") + "'>" + esc(text) + "</span>";
  }

  function receiptCell(row, previous) {
    if (row.movementState === "future") return FUTURE;
    const item = receiptOf(row.month);
    if (!item || (row.financeState !== "month" && row.financeState !== "partial")) return MISSING;
    const note = item.outstandingKop ? "ещё " + money(item.outstandingKop) + " не пришло" : "сверено";
    return money(item.receivedKop) + receiptDelta(row, previous) + "<br><span class='muted'>" + esc(note) + "</span>";
  }

  function receiptTotal(chosen) {
    const viewed = receiptView(chosen, "0000-01-01", "9999-12-31");
    if (!viewed.ready) return MISSING;
    const gap = viewed.outstanding ? "<br><span class='muted'>ещё " + esc(money(viewed.outstanding)) + " не пришло</span>" : "";
    return money(viewed.received) + gap;
  }

  function receiptView(chosen, from, to) {
    const picked = chosen.filter(function (row) { return row.useFinance; }).map(function (row) {
      return receiptOf(row.month);
    }).filter(Boolean);
    const prior = (DATA.receipts && DATA.receipts.prior || []).filter(function (item) {
      return item.paid >= from && item.paid <= to;
    });
    return {
      ready: picked.length > 0,
      received: picked.reduce(function (acc, item) { return acc + item.receivedKop; }, 0),
      outstanding: picked.reduce(function (acc, item) { return acc + item.outstandingKop; }, 0),
      priorSum: prior.reduce(function (acc, item) { return acc + item.kop; }, 0),
    };
  }

  function cashCard(state, chosen) {
    if (state.brand) {
      return card("Фактические поступления", MISSING, "Банковская выписка на бренд не делится. Ноль не подставлен.", "#ask", "Как сверено", "gap");
    }
    const viewed = receiptView(chosen, state.from, state.to);
    if (!viewed.ready || !DATA.receipts) {
      return card("Фактические поступления", MISSING, "За выбранные даты отчёта исполнителя нет. Ноль не подставлен.", "#ask", "Как сверено", "gap");
    }
    let sub = "Это деньги по отчётам внутри выбранных дат: аванс и строка «к оплате», уже пришедшие на счёт. Аванс в соседней карточке «начислено к выплате» уже вычтен, поэтому поступление больше начисления. Плательщик " + DATA.receipts.payer + ". Выписка по 29.10.2026.";
    if (viewed.priorSum) sub += " Ещё " + money(viewed.priorSum) + " пришло в выбранные даты по отчётам 2025 года и в эту цифру не входит.";
    if (viewed.outstanding) sub += " Не пришло " + money(viewed.outstanding) + ": " + NO_CASH + " в выписке по 29.10.2026.";
    return card("Фактические поступления", "<span class=\"hero-value\">" + money(viewed.received) + "</span>", sub, "#ask", "Как сверено", "gap");
  }

  function receiptSentence(row) {
    const item = receiptOf(row.month);
    if (!item) return "Фактические поступления: " + MISSING + ".";
    let text = "Фактически поступило " + money(item.receivedKop);
    const dates = [];
    if (item.advancePaid) dates.push("аванс " + money(item.advanceKop) + " пришёл " + dayText(item.advancePaid));
    if (item.payoutPaid) dates.push("«к оплате» " + money(item.payoutReceivedKop) + " пришло " + dayText(item.payoutPaid));
    if (dates.length) text += ": " + dates.join(", ");
    text += ".";
    if (item.outstandingKop) text += " Ещё " + money(item.outstandingKop) + " в выписке по 29.10.2026 нет: " + NO_CASH + ".";
    else text += " Суммы совпали с отчётом.";
    return text;
  }

  function receiptPanel() {
    if (!DATA.receipts) return "";
    const rows = DATA.receipts.months.map(function (item) {
      const arrived = [];
      if (item.advancePaid) arrived.push("аванс " + money(item.advanceKop) + " " + dayText(item.advancePaid));
      if (item.payoutPaid) arrived.push("к оплате " + money(item.payoutReceivedKop) + " " + dayText(item.payoutPaid));
      const gap = item.outstandingKop ? money(item.outstandingKop) : "нет";
      return "<tr><td>" + esc(MONTH_NAME[item.month.slice(5)]) + "</td><td class='num'>" + esc(money(item.receivedKop))
        + "</td><td>" + esc(arrived.join("; ")) + "</td><td class='num'>" + esc(gap) + "</td></tr>";
    }).join("");
    const prior = DATA.receipts.prior.map(function (item) {
      return "<li>" + esc(dayText(item.paid)) + ": " + esc(money(item.kop)) + " по отчёту от " + esc(dayText(item.reportOn))
        + ". В месяцы 2026 не прибавлено, сам отчёт в системе не загружен.</li>";
    }).join("");
    return "<h2>Сверка с выпиской</h2><div class='panel'><p>Плательщик — " + esc(DATA.receipts.payer)
      + ". Две выписки с 1 января по 29 октября 2026, всего " + esc(money(DATA.receipts.statementKop))
      + ". Номера счетов здесь не показаны. Поступило по отчёту — аванс плюс «к оплате». Конечная выплата за сентябрь в выписке ещё не найдена.</p></div>"
      + "<div class='table-wrap'><table><thead><tr><th>Месяц отчёта</th><th class='num'>Поступило</th><th>Платежи</th><th class='num'>Не пришло</th></tr></thead><tbody>"
      + rows + "</tbody></table></div><ul>" + prior + "</ul>";
  }

  function accrualCharts(chosen) {
    const labels = [];
    const payouts = [];
    const tips = [];
    const received = [];
    const receivedTips = [];
    const cumulative = [];
    const cumulativeTips = [];
    let running = 0;
    chosen.forEach(function (row) {
      if (!row.useFinance) return;
      const label = SHORT_MONTH[row.month.slice(5)] + (row.financeState === "partial" ? "*" : "");
      labels.push(label);
      payouts.push(row.payoutKop / 100);
      tips.push(label + ": начислено " + money(row.payoutKop));
      const item = receiptOf(row.month);
      if (!item) {
        received.push(null);
        receivedTips.push(label + ": поступления в выписке нет");
      } else {
        received.push(item.receivedKop / 100);
        let arrived = label + ": поступило " + money(item.receivedKop);
        if (item.outstandingKop) arrived += ", ещё не пришло " + money(item.outstandingKop);
        receivedTips.push(arrived);
      }
      running += row.payoutKop;
      cumulative.push(running / 100);
      cumulativeTips.push(label + ": накоплено начислений " + money(running));
    });
    return drawBars(
      "Начисление и поступление по месяцам",
      labels,
      [
        { name: "Начислено к выплате", color: "#69465F", values: payouts, tips: tips },
        { name: "Поступило на счёт", color: "#4F6272", values: received, tips: receivedTips },
      ],
      "«Начислено к выплате» — строка «к оплате» после вычета аванса. «Поступило на счёт» — аванс и «к оплате», которые уже пришли. Поступление выше начисления на сумму аванса, это не вторая выплата. Сентябрь: в выписке есть аванс, конечная выплата ещё не пришла. Платежи по отчётам 2025 года в столбики не входят. Октябрь со звёздочкой — начисление только до 15 октября."
    ) + drawLine(
      "Накопительный итог начислений с начала выбранного периода",
      labels,
      cumulative,
      cumulativeTips,
      "Линия складывает «к оплате» из отчётов исполнителя. Это не деньги на счёте и не остаток после себестоимости."
    );
  }

  function card(label, value, sub, href, link, kind) {
    const more = href ? "<a class='more' href='" + href + "'>" + esc(link) + "</a>" : "";
    return "<div class='card " + (kind || "") + "'><div class='label'>" + label + "</div><div class='value'>" + value + "</div><div class='sub'>" + sub + "</div>" + more + "</div>";
  }

  function pairValue(kop, count) {
    const countHtml = count == null ? "" : "<div class='value value-second'>" + esc(qty(count)) + " шт.</div>";
    return (kop == null ? MISSING : esc(money(kop))) + countHtml;
  }

  function productTable(rows, caption) {
    if (!rows.length) return "<h3>" + esc(caption) + "</h3><p>Нет данных.</p>";
    const body = rows.map(function (row) {
      return "<tr><td>" + esc(row.article) + "</td><td>" + esc(brandLabel(row.brand)) + "</td><td>" + esc(row.name) + "</td>"
        + "<td class='num'>" + esc(qty(row.orderedQty)) + "</td><td class='num'>" + esc(money(row.orderedKop)) + "</td>"
        + "<td class='num'>" + esc(qty(row.deliveredQty)) + "</td><td class='num'>" + esc(money(row.deliveredKop)) + "</td></tr>";
    }).join("");
    return "<h3>" + esc(caption) + "</h3><div class='table-wrap'><table><thead><tr><th>Артикул</th><th>Бренд</th><th>Название</th>"
      + "<th class='num'>Заказано, шт.</th><th class='num'>Заказано</th><th class='num'>Доставлено, шт.</th><th class='num'>Доставлено</th></tr></thead><tbody>"
      + body + "</tbody></table></div>";
  }

  function spanCheck(from, to, movement, brand) {
    if (brand || !movement || !DATA.span || from > "2026-01-01" || to < "2026-10-27") return "";
    const span = DATA.span;
    const same = movement.orderedQty === span.orderedQty && movement.orderedKop === span.orderedKop
      && movement.deliveredQty === span.deliveredQty && movement.deliveredKop === span.deliveredKop;
    let text = "Сводный файл 01.01.2026–27.10.2026: заказано " + qty(span.orderedQty) + " шт. на " + money(span.orderedKop)
      + ", доставлено " + qty(span.deliveredQty) + " шт. на " + money(span.deliveredKop) + ".";
    text += same
      ? " Сумма отдельных месяцев совпадает со сводом. Свод второй раз не прибавлен."
      : " Сумма отдельных месяцев со сводом не совпадает. На экране оставлены месяцы, свод к ним не прибавлен.";
    return "<div class='panel'><p>" + esc(text) + "</p></div>";
  }

  function dynamics(chosen) {
    const bits = [];
    const full = chosen.filter(function (row) { return row.useMovement && row.movementState === "month"; });
    if (full.length) {
      const peak = full.slice().sort(function (a, b) { return b.orderedQty - a.orderedQty || b.orderedKop - a.orderedKop; })[0];
      bits.push("Самый полный месяц по числу заказов в выбранных датах — " + MONTH_NAME[peak.month.slice(5)].toLowerCase() + ": " + qty(peak.orderedQty) + " шт. на " + money(peak.orderedKop) + ".");
      const ahead = full.filter(function (row) { return row.deliveredQty > row.orderedQty; })
        .map(function (row) { return MONTH_NAME[row.month.slice(5)].toLowerCase(); });
      if (ahead.length) {
        bits.push("Доставлено больше, чем заказано в том же месяце: " + ahead.join(", ") + ". Это доставки более ранних заказов. Разница заказа и доставки отменой не называется.");
      }
      const richest = full.slice().sort(function (a, b) { return (b.payoutKop || 0) - (a.payoutKop || 0); })[0];
      bits.push("Самое большое начисление полного месяца — " + MONTH_NAME[richest.month.slice(5)].toLowerCase() + ": " + money(richest.payoutKop) + ". Это «к оплате», не поступление на счёт.");
    }
    if (chosen.some(function (row) { return row.month === "2026-10" && (row.movementState === "partial" || row.financeState === "partial"); })) {
      bits.push("Сравнивать октябрь с сентябрём нельзя: октябрь не закончен. Заказы в аналитике до 27 октября, начисление в отчёте исполнителя до 15 октября. Сентябрь закрыт полным месяцем.");
    }
    if (!bits.length) return "<p>Для выбранных дат полного месяца, по которому видна динамика, нет.</p>";
    return bits.map(function (bit) { return "<p>" + esc(bit) + "</p>"; }).join("");
  }

  function yearTable(chosen) {
    let previous = null;
    const body = DATA.months.map(function (row) {
      const name = MONTH_NAME[row.month.slice(5)];
      const deductions = (row.financeState === "month" || row.financeState === "partial")
        ? (row.advancesKop || 0) + (row.marketingKop || 0) : null;
      row.deductionsKop = deductions;
      let returns = amountCell(row, "financeState", row.returnsKop);
      if ((row.financeState === "month" || row.financeState === "partial") && row.returnsKop === 0) {
        returns += "<br><span class='muted'>подтверждено</span>";
      }
      const paid = receiptCell(row, previous);
      const partialMove = row.movementState === "partial"
        ? "<br><span class='muted'>" + esc(dayText(row.analyticsStart)) + "–" + esc(dayText(row.analyticsEnd)) + "</span>" : "";
      const partialPay = row.financeState === "partial"
        ? "<br><span class='muted'>" + esc(dayText(row.financeStart)) + "–" + esc(dayText(row.financeEnd)) + "</span>" : "";
      const html = "<tr><td><a href='#m/" + esc(row.month) + "'>" + esc(name) + "</a></td>"
        + "<td class='num'>" + countCell(row, "movementState", row.orderedQty) + "</td>"
        + "<td class='num'>" + amountCell(row, "movementState", row.orderedKop) + delta(row, previous, "movementState", "orderedKop") + partialMove + "</td>"
        + "<td class='num'>" + countCell(row, "movementState", row.deliveredQty) + "</td>"
        + "<td class='num'>" + amountCell(row, "movementState", row.deliveredKop) + "</td>"
        + "<td class='num'>" + returns + "</td>"
        + "<td class='num'>" + amountCell(row, "financeState", row.commissionAfterKop) + delta(row, previous, "financeState", "commissionAfterKop", false) + "</td>"
        + "<td class='num'>" + amountCell(row, "financeState", deductions) + delta(row, previous, "financeState", "deductionsKop", false) + "</td>"
        + "<td class='num'>" + amountCell(row, "financeState", row.payoutKop) + delta(row, previous, "financeState", "payoutKop") + partialPay + "</td>"
        + "<td>" + esc(paid) + "</td><td>" + esc(statusText(row)) + "</td></tr>";
      previous = row;
      return html;
    }).join("");
    const readyMove = chosen.some(function (row) { return row.useMovement; });
    const readyFin = chosen.some(function (row) { return row.useFinance; });
    const totalOther = readyFin ? chosen.filter(function (row) { return row.useFinance; }).reduce(function (acc, row) {
      return acc + (row.advancesKop || 0) + (row.marketingKop || 0);
    }, 0) : null;
    const partial = chosen.some(function (row) { return row.movementState === "partial" || row.financeState === "partial"; });
    let totalStatus = chosen.length ? "Сумма файлов, которые целиком попали в выбранные даты." : "В выбранных датах загруженного файла нет.";
    if (partial) totalStatus += " Неполный месяц в сумму входит и с полным месяцем не сравнивается.";
    function totalMoney(value, ready) { return !ready || value == null ? MISSING : esc(money(value)); }
    function totalQty(value, ready) { return !ready || value == null ? MISSING : esc(qty(value)); }
    const total = "<tr class='total'><td>Итого в выбранных датах</td>"
      + "<td class='num'>" + totalQty(sumQty(chosen, "orderedQty", "useMovement"), readyMove) + "</td>"
      + "<td class='num'>" + totalMoney(sumKop(chosen, "orderedKop", "useMovement"), readyMove) + "</td>"
      + "<td class='num'>" + totalQty(sumQty(chosen, "deliveredQty", "useMovement"), readyMove) + "</td>"
      + "<td class='num'>" + totalMoney(sumKop(chosen, "deliveredKop", "useMovement"), readyMove) + "</td>"
      + "<td class='num'>" + totalMoney(sumKop(chosen, "returnsKop", "useFinance"), readyFin) + "</td>"
      + "<td class='num'>" + totalMoney(sumKop(chosen, "commissionAfterKop", "useFinance"), readyFin) + "</td>"
      + "<td class='num'>" + totalMoney(totalOther, readyFin) + "</td>"
      + "<td class='num'>" + totalMoney(sumKop(chosen, "payoutKop", "useFinance"), readyFin) + "</td>"
      + "<td class='num'>" + receiptTotal(chosen) + "</td><td>" + esc(totalStatus) + "</td></tr>";
    return "<p class='muted scroll-hint'>Таблицу можно двигать пальцем в сторону.</p><div class='table-wrap'><table id='year-table'><thead><tr>"
      + "<th>Месяц</th><th class='num'>Заказано, шт.</th><th class='num'>Заказано</th><th class='num'>Доставлено, шт.</th><th class='num'>Доставлено</th>"
      + "<th class='num'>Возвраты</th><th class='num'>Комиссия</th><th class='num'>Прочие удержания</th><th class='num'>Начислено к выплате</th><th>Поступило</th><th>Полнота и сверка</th>"
      + "</tr></thead><tbody>" + body + total + "</tbody></table></div>"
      + "<p class='muted'>Комиссия — вознаграждение после скидки. Скидка уже вычтена и второй раз не вычитается. Прочие удержания — авансы и маркетинг из подвала. Логистика в отчёте не указана и нулём в эту колонку не входит. Колонка «Поступило» — деньги, которые уже пришли по этому отчёту. Процент под суммой — изменение к предыдущему полному месяцу. Зелёный — благоприятное изменение, терракотовый — неблагоприятное. Для комиссии и прочих удержаний рост не считается благоприятным. Сама сумма цветом не отмечается: маленькая цифра не значит плохой месяц. План не задан. Нажмите месяц, чтобы открыть товары, бренды и склады.</p>";
  }

  function filterForm(state) {
    const options = ["<option value=''>Все бренды</option>"].concat(DATA.brands.map(function (item) {
      return "<option value='" + esc(item) + "'" + (item === state.brand ? " selected" : "") + ">" + esc(item) + "</option>";
    }));
    return "<form class='filters' id='period-filter'><label>С даты<input type='date' name='from' value='" + esc(state.from) + "'></label>"
      + "<label>По дату<input type='date' name='to' value='" + esc(state.to) + "'></label>"
      + "<label>Бренд<select name='brand'>" + options.join("") + "</select></label><button type='submit'>Показать</button></form>";
  }

  function stockBlock() {
    const stock = DATA.stock;
    if (!stock) return "<h2 id='stock'>Остатки</h2><p>Нет данных. Снимка оборачиваемости нет.</p>";
    const central = stock.locations.filter(function (row) { return row.location === "Центральный склад"; })[0];
    const total = stock.locations.reduce(function (acc, row) { return acc + row.stockQty; }, 0);
    const places = stock.locations.map(function (row) {
      return "<tr><td>" + esc(row.location) + "</td><td class='num'>" + esc(qty(row.stockQty)) + "</td><td class='num'>" + esc(qty(row.sold30)) + "</td></tr>";
    }).join("");
    const sellers = stock.sellers.map(function (row) {
      return "<tr><td>" + esc(row.article) + "</td><td>" + esc(brandLabel(row.brand)) + "</td><td>" + esc(row.name) + "</td>"
        + "<td class='num'>" + esc(qty(row.stockQty)) + "</td><td class='num'>" + esc(qty(row.sold30)) + "</td><td class='num'>" + esc(qty(row.coverDays)) + "</td></tr>";
    }).join("");
    return "<h2 id='stock'>Остатки</h2><div class='panel'><p>Снимок на " + esc(dayText(stock.asOf)) + ": центральный склад "
      + esc(qty(central ? central.stockQty : null)) + " шт., все площадки " + esc(qty(total)) + " шт. Это оборачиваемость на дату выгрузки, не остаток на конец января или сентября. Колонка остатка внутри файлов аналитики в эту цифру не входит.</p>"
      + "<p>Без продаж 14 дней и дольше на центральном складе: " + esc(qty(stock.idleSkus)) + " позиций, " + esc(qty(stock.idleUnits)) + " шт.</p></div>"
      + "<div class='table-wrap'><table><thead><tr><th>Площадка</th><th class='num'>Остаток, шт.</th><th class='num'>Продано за 30 дней</th></tr></thead><tbody>" + places + "</tbody></table></div>"
      + "<h3>Центральный склад: что продавалось за 30 дней до снимка</h3><div class='table-wrap'><table><thead><tr><th>Артикул</th><th>Бренд</th><th>Название</th><th class='num'>Остаток</th><th class='num'>Продано</th><th class='num'>Запас, дни</th></tr></thead><tbody>"
      + (sellers || "<tr><td colspan='6'>Нет данных.</td></tr>") + "</tbody></table></div>";
  }

  function financeParagraph(row) {
    if (row.financeState !== "month" && row.financeState !== "partial") return "<p>Отчёт исполнителя: Нет данных.</p>";
    const rates = (row.lineBrands || []).map(function (item) {
      const list = (item.rates || []).map(function (rate) { return qty(rate) + "%"; }).join(", ");
      return brandLabel(item.brand) + (list ? " " + list : "");
    }).join("; ");
    return "<p>Начисление за " + esc(dayText(row.financeStart)) + "–" + esc(dayText(row.financeEnd))
      + ". Реализация " + esc(money(row.realizationKop)) + ", возвраты " + esc(money(row.returnsKop))
      + ", вознаграждение после скидки " + esc(money(row.commissionAfterKop))
      + ", авансы " + esc(money(row.advancesKop)) + ", маркетинг " + esc(money(row.marketingKop))
      + ". Начислено к выплате " + esc(money(row.payoutKop)) + ". " + receiptSentence(row) + "</p>"
      + (rates ? "<p>Ставки вознаграждения в строках, без усреднения: " + esc(rates) + ".</p>" : "");
  }

  const NOT_CALC = "Не рассчитана";

  function profitMoney(state, value) {
    if (state === "future") return FUTURE;
    if (state === "missing") return MISSING;
    if (state === "known" || state === "partial") return money(value);
    return NOT_CALC;
  }

  function shareText(state, saleKop, confirmedKop) {
    if (state === "future") return FUTURE;
    if (!saleKop) return MISSING;
    const percent = (confirmedKop || 0) / saleKop * 100;
    if (Math.abs(percent - Math.round(percent)) < 0.05) return String(Math.round(percent)) + "%";
    return percent.toFixed(1).replace(".", ",") + "%";
  }

  function profitRows(from, to) {
    if (!DATA.profit) return [];
    return DATA.profit.months.filter(function (row) {
      return row.start <= to && row.end >= from;
    });
  }

  function foldProfit(rows) {
    const active = rows.filter(function (row) { return row.revenueState !== "future"; });
    const future = rows.filter(function (row) { return row.revenueState === "future"; });
    const futureView = {
      revenueState: "future", cogsState: "future", grossState: "future", commissionState: "future",
      adsState: "future", logisticsState: "future", storageState: "future", returnsHandlingState: "future",
      marketplaceState: "future", afterState: "future", overheadState: "future", taxState: "future", profitState: "future",
    };
    if (!active.length && future.length) return futureView;
    const withRevenue = active.filter(function (row) { return row.revenueKop != null; });
    if (!withRevenue.length) {
      return {
        revenueState: "missing", cogsState: "missing", grossState: "missing", commissionState: "missing",
        adsState: "missing", logisticsState: "missing", storageState: "missing", returnsHandlingState: "missing",
        marketplaceState: "missing", afterState: "missing", overheadState: "missing",
        taxState: "not_calculated", profitState: "not_calculated",
      };
    }
    function sum(key) {
      return withRevenue.reduce(function (acc, row) { return acc + (row[key] || 0); }, 0);
    }
    function every(key, value) {
      return active.every(function (row) { return row[key] === value; });
    }
    const sale = sum("saleKop");
    const confirmed = sum("confirmedSaleKop");
    return {
      revenueState: withRevenue.some(function (row) { return row.partial; }) ? "partial" : "known",
      revenueKop: sum("revenueKop"),
      saleKop: sale,
      confirmedSaleKop: confirmed,
      cogsState: withRevenue.every(function (row) { return row.cogsState === "known"; }) ? "known" : "not_calculated",
      cogsKop: withRevenue.every(function (row) { return row.cogsState === "known"; }) ? withRevenue.reduce(function (acc, row) { return acc + row.cogsKop; }, 0) : null,
      grossState: withRevenue.every(function (row) { return row.grossState === "known"; }) ? "known" : "not_calculated",
      grossKop: withRevenue.every(function (row) { return row.grossState === "known"; }) ? withRevenue.reduce(function (acc, row) { return acc + row.revenueKop - row.cogsKop; }, 0) : null,
      commissionState: every("commissionState", "known") ? "known" : "missing",
      commissionKop: every("commissionState", "known") ? active.reduce(function (acc, row) { return acc + row.commissionKop; }, 0) : null,
      adsState: every("adsState", "known") ? "known" : "missing",
      adsKop: every("adsState", "known") ? active.reduce(function (acc, row) { return acc + row.adsKop; }, 0) : null,
      logisticsState: every("logisticsState", "known") ? "known" : "missing",
      storageState: every("storageState", "known") ? "known" : "missing",
      returnsHandlingState: every("returnsHandlingState", "known") ? "known" : "missing",
      marketplaceState: "not_calculated",
      afterState: "not_calculated",
      overheadState: "missing",
      taxState: "not_calculated",
      profitState: "not_calculated",
      partial: withRevenue.some(function (row) { return row.partial; }),
      openingLoaded: !!(DATA.profit && DATA.profit.openingLoaded),
    };
  }

  function profitSection(state) {
    const rows = profitRows(state.from, state.to);
    const view = foldProfit(rows);
    const notes = [
      "Выручка здесь — реализация отчёта исполнителя плюс возвраты. Колонка доставки из аналитики второй раз не прибавляется. «К оплате» и деньги на счёте в эту таблицу не входят: это не прибыль.",
      "Себестоимость списывается с более ранней партии. Остаток на 1 января 2026 — первая партия. Новая закупка попадает в расходы только когда проданы её штуки, а не в месяц оплаты всей партии.",
    ];
    if (!DATA.profit || !DATA.profit.openingLoaded) {
      notes.push("Начального остатка на 1 января 2026 нет, поэтому списание ещё не начато. Поздняя цена закупки на старые штуки не ставится.");
    }
    const pilot = rows.filter(function (row) { return row.month === "2026-09" && row.revenueState === "known"; })[0];
    if (pilot) {
      notes.push("Проверка на полном месяце — сентябрь 2026. Выручка с учётом возвратов " + money(pilot.revenueKop) + ". Комиссия " + money(pilot.commissionKop) + ", маркетинг " + money(pilot.adsKop) + " — это суммы отчёта. Себестоимость этого месяца не подставлена: подтверждено " + shareText(pilot.revenueState, pilot.saleKop, pilot.confirmedSaleKop) + " продаж.");
    }
    if (view.partial) notes.push("В выбранных датах есть неполный отчёт. Его выручка входит в сумму, итоговая прибыль из неполного месяца не собирается.");
    if (state.brand) notes.push("Фильтр бренда «" + state.brand + "» прибыль не делит: возвраты и подвал общие на кабинет. Ноль по бренду не подставлен.");
    const line = function (label, value, sub) {
      return "<tr><td" + (sub ? " class='subline'" : "") + ">" + esc(label) + "</td><td class='num'>" + esc(value) + "</td></tr>";
    };
    const body = [
      line("Выручка с учётом возвратов", profitMoney(view.revenueState, view.revenueKop)),
      line("Себестоимость проданных товаров", profitMoney(view.cogsState, view.cogsKop)),
      line("Доля продаж с подтверждённой себестоимостью", shareText(view.revenueState, view.saleKop, view.confirmedSaleKop)),
      line("Валовая прибыль", profitMoney(view.grossState, view.grossKop)),
      line("Расходы маркетплейса", profitMoney(view.marketplaceState, null)),
      line("Комиссия этого кабинета", profitMoney(view.commissionState, view.commissionKop), true),
      line("Реклама", profitMoney(view.adsState, view.adsKop) + (view.adsState === "known" ? " · подтверждено отчётом" : ""), true),
      line("Логистика", profitMoney(view.logisticsState, null), true),
      line("Хранение", profitMoney(view.storageState, null), true),
      line("Обработка возвратов", profitMoney(view.returnsHandlingState, null), true),
      line("Результат после расходов площадки", profitMoney(view.afterState, null)),
      line("Общие расходы", profitMoney(view.overheadState, null)),
      line("Налоги", profitMoney(view.taxState, null)),
      line("Итоговая прибыль", profitMoney(view.profitState, null)),
    ].join("");
    const monthRows = rows.map(function (row) {
      const extra = row.partial ? "<br><span class='muted'>неполный отчёт</span>" : "";
      return "<tr><td>" + esc(MONTH_NAME[row.month.slice(5)]) + "</td><td class='num'>" + esc(profitMoney(row.revenueState, row.revenueKop)) + extra
        + "</td><td class='num'>" + esc(profitMoney(row.cogsState, row.cogsKop))
        + "</td><td class='num'>" + esc(shareText(row.revenueState, row.saleKop, row.confirmedSaleKop))
        + "</td><td class='num'>" + esc(profitMoney(row.profitState, null)) + "</td></tr>";
    }).join("");
    return "<section id='profit'><h2>Прибыль</h2><div class='panel'>" + notes.map(function (note) { return "<p>" + esc(note) + "</p>"; }).join("")
      + "</div><div class='table-wrap'><table><thead><tr><th>Показатель</th><th class='num'>Сумма</th></tr></thead><tbody>" + body + "</tbody></table></div>"
      + "<p class='muted'>Комиссия — вознаграждение после скидки по строкам этого кабинета. Одна ставка на все бренды не ставится, и из «к оплате» комиссия повторно не вычитается. Аванс в расходы не входит. Логистика, хранение и обработка возвратов в отчёте Л’Этуаль не указаны, поэтому расходы площадки целиком не сложены. Налог не посчитан: режим и база этого юрлица не заданы. Пока строка итоговой прибыли не рассчитана, прибылью она не называется.</p>"
      + "<h3>По месяцам выбранных дат</h3><div class='table-wrap'><table><thead><tr><th>Месяц</th><th class='num'>Выручка с учётом возвратов</th><th class='num'>Себестоимость</th><th class='num'>Доля с себестоимостью</th><th class='num'>Итоговая прибыль</th></tr></thead><tbody>"
      + monthRows + "</tbody></table></div></section>";
  }

  function profitMonthBlock(row, brand) {
    if (!row || row.revenueState === "future") return "<p>Прибыль за этот месяц не считается: период ещё не наступил.</p>";
    const line = function (label, value) {
      return "<tr><td>" + esc(label) + "</td><td class='num'>" + esc(value) + "</td></tr>";
    };
    const body = [
      line("Выручка с учётом возвратов", profitMoney(row.revenueState, row.revenueKop)),
      line("Себестоимость проданных товаров", profitMoney(row.cogsState, row.cogsKop)),
      line("Доля продаж с подтверждённой себестоимостью", shareText(row.revenueState, row.saleKop, row.confirmedSaleKop)),
      line("Валовая прибыль", NOT_CALC),
      line("Расходы маркетплейса", NOT_CALC),
      line("Комиссия этого кабинета", profitMoney(row.commissionState, row.commissionKop)),
      line("Реклама", profitMoney(row.adsState, row.adsKop) + (row.adsState === "known" ? " · подтверждено отчётом" : "")),
      line("Логистика", MISSING),
      line("Хранение", MISSING),
      line("Обработка возвратов", MISSING),
      line("Результат после расходов площадки", NOT_CALC),
      line("Общие расходы", MISSING),
      line("Налоги", NOT_CALC),
      line("Итоговая прибыль", NOT_CALC),
    ].join("");
    const brandNote = brand ? "<p class='muted'>Фильтр бренда на эту таблицу не действует: подвал отчёта общий на кабинет.</p>" : "";
    return "<h2>Прибыль</h2><p class='muted'>Это не «к оплате» и не поступление на счёт. Себестоимость без партии не подставляется.</p>"
      + brandNote + "<div class='table-wrap'><table><thead><tr><th>Показатель</th><th class='num'>Сумма</th></tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function renderMonth(key, state) {
    const row = DATA.months.filter(function (item) { return item.month === key; })[0];
    if (!row) return "<p>Такого месяца нет.</p>";
    const name = MONTH_NAME[key.slice(5)] + " " + key.slice(0, 4);
    if (row.movementState === "future") {
      return "<p><a href='#year'>К сводке</a></p><div class='panel'><p>" + esc(name) + ". Период ещё не наступил. Нулевые продажи не подставлены.</p></div>";
    }
    let html = "<p><a href='#year'>К сводке</a></p><div class='panel'><p><b>" + esc(name) + ".</b> " + esc(statusText(row)) + "</p>";
    if (row.movementState === "month" || row.movementState === "partial") {
      html += "<p>Заказы и доставки: " + esc(dayText(row.analyticsStart)) + "–" + esc(dayText(row.analyticsEnd))
        + ". Заказано " + esc(qty(row.orderedQty)) + " шт. на " + esc(money(row.orderedKop))
        + ", доставлено " + esc(qty(row.deliveredQty)) + " шт. на " + esc(money(row.deliveredKop)) + ".</p>";
    } else {
      html += "<p>Файл заказов: Нет данных.</p>";
    }
    html += financeParagraph(row) + "</div>";
    if (state.brand) {
      html += "<p class='muted'>Фильтр бренда: " + esc(state.brand) + ". Товары и склады ниже — этого бренда. Подвал выше — на весь отчёт.</p>";
    }
    const lines = linesOf(row, state.brand);
    const brands = rollup(lines, "brand");
    if (brands.length) {
      html += "<h2>Бренды</h2><div class='table-wrap'><table><thead><tr><th>Бренд</th><th class='num'>Заказано, шт.</th><th class='num'>Заказано</th><th class='num'>Доставлено, шт.</th><th class='num'>Доставлено</th></tr></thead><tbody>"
        + brands.map(function (item) {
          return "<tr><td>" + esc(brandLabel(item.key)) + "</td><td class='num'>" + esc(qty(item.orderedQty)) + "</td><td class='num'>" + esc(money(item.orderedKop)) + "</td><td class='num'>" + esc(qty(item.deliveredQty)) + "</td><td class='num'>" + esc(money(item.deliveredKop)) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    const places = rollup(lines, "warehouse");
    if (places.length) {
      html += "<h2>Склады</h2><p class='muted'>Колонка «Всего» в сумму не входит.</p><div class='table-wrap'><table><thead><tr><th>Склад</th><th class='num'>Заказано, шт.</th><th class='num'>Заказано</th><th class='num'>Доставлено, шт.</th><th class='num'>Доставлено</th></tr></thead><tbody>"
        + places.map(function (item) {
          return "<tr><td>" + esc(item.key) + "</td><td class='num'>" + esc(qty(item.orderedQty)) + "</td><td class='num'>" + esc(money(item.orderedKop)) + "</td><td class='num'>" + esc(qty(item.deliveredQty)) + "</td><td class='num'>" + esc(money(item.deliveredKop)) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    const products = rollup(lines.map(function (line) {
      return Object.assign({}, line, { group: line.article + "\0" + line.brand + "\0" + line.name });
    }), "group").map(function (item) {
      const parts = item.key.split("\0");
      return { article: parts[0], brand: parts[1], name: parts[2], orderedQty: item.orderedQty, orderedKop: item.orderedKop, deliveredQty: item.deliveredQty, deliveredKop: item.deliveredKop };
    });
    const byQty = products.slice().sort(function (a, b) { return b.deliveredQty - a.deliveredQty || b.deliveredKop - a.deliveredKop; });
    html += productTable(products, "Товары по сумме доставки") + productTable(byQty, "Товары по количеству доставки");
    const profitRow = (DATA.profit && DATA.profit.months || []).filter(function (item) { return item.month === key; })[0];
    html += profitMonthBlock(profitRow, state.brand);
    return html;
  }

  function renderHome(state) {
    const chosen = screenMonths(state.from, state.to);
    const movement = movementFigures(chosen, state.brand);
    const moveWindow = windowPhrase(chosen, "useMovement", "analyticsStart", "analyticsEnd");
    const finWindow = windowPhrase(chosen, "useFinance", "financeStart", "financeEnd");
    const movePartial = partialNames(chosen, "useMovement", "movementState");
    const finPartial = partialNames(chosen, "useFinance", "financeState");
    const brandNote = state.brand ? " Бренд карточек и рейтинга: " + state.brand + "." : "";
    let orderedSub;
    let deliveredSub;
    if (movement && movement.checkedEmpty) {
      orderedSub = "В загруженных файлах за " + esc(moveWindow) + " движения бренда нет. Это проверенный ноль.";
      deliveredSub = orderedSub;
    } else if (!movement) {
      orderedSub = "За выбранные даты отдельного файла заказов нет. Ноль не подставлен.";
      deliveredSub = orderedSub;
    } else {
      orderedSub = "Источник: аналитика продаж со складами, отдельные файлы месяцев. Период файлов: " + esc(moveWindow) + "."
        + (movePartial.length ? " Неполный месяц внутри суммы: " + esc(movePartial.join(", ")) + "." : "")
        + " Это сумма заказов, не выручка и не поступление денег." + esc(brandNote);
      deliveredSub = "Источник: та же аналитика, колонка доставки. Период файлов: " + esc(moveWindow) + "."
        + (movePartial.length ? " Неполный месяц внутри суммы: " + esc(movePartial.join(", ")) + "." : "")
        + " Кабинет относит доставку к реестру курьера, сюда входят и более ранние заказы. Возврат из этой суммы не вычтен. Рядом с реализацией отчёта исполнителя эта сумма второй раз не прибавляется.";
    }
    let returnsValue = MISSING;
    let returnsSub = "Отчёта исполнителя за выбранные даты нет. Ноль не подставлен.";
    let payoutValue = MISSING;
    let payoutSub = "Отчёта исполнителя за выбранные даты нет.";
    let commissionValue = MISSING;
    let commissionSub = "Отчёта исполнителя за выбранные даты нет.";
    if (state.brand) {
      returnsSub = "Возвраты записаны в подвале отчёта и по брендам не разложены.";
      payoutSub = "Подвал «к оплате» общий на весь отчёт. На один бренд он не делится, ноль вместо него не стоит.";
      const financeRows = chosen.filter(function (row) { return row.useFinance; });
      if (financeRows.length) {
        const commission = financeRows.reduce(function (acc, row) {
          return acc + (row.lineBrands || []).filter(function (item) { return item.brand === state.brand; })
            .reduce(function (inner, item) { return inner + item.commissionKop; }, 0);
        }, 0);
        const found = financeRows.some(function (row) {
          return (row.lineBrands || []).some(function (item) { return item.brand === state.brand; });
        });
        commissionValue = found ? esc(money(commission)) : "0 ₽";
        commissionSub = found
          ? "Источник: строки отчётов исполнителя бренда " + esc(state.brand) + " за " + esc(finWindow) + ". Это вознаграждение в строках. Скидка исполнителя лежит в подвале и по брендам не разложена."
          : "В строках загруженных отчётов этого бренда нет. Это проверенный ноль, не пустой месяц.";
      }
    } else {
      const returns = sumKop(chosen, "returnsKop", "useFinance");
      const payout = sumKop(chosen, "payoutKop", "useFinance");
      const commission = sumKop(chosen, "commissionAfterKop", "useFinance");
      const advances = sumKop(chosen, "advancesKop", "useFinance");
      const marketing = sumKop(chosen, "marketingKop", "useFinance");
      const finNote = finPartial.length ? " Неполный месяц внутри суммы: " + esc(finPartial.join(", ")) + "." : "";
      if (returns != null) {
        returnsValue = esc(money(returns));
        returnsSub = "Источник: подвал отчётов исполнителя. Период отчётов: " + esc(finWindow) + "." + finNote + " Из колонки доставки эта сумма не вычиталась.";
      }
      if (payout != null) {
        payoutValue = esc(money(payout));
        payoutSub = "Источник: строка «к оплате» в подвале. Период отчётов: " + esc(finWindow) + "." + finNote
          + " Это начисление. Аванс из этой строки уже вычтен и приходит отдельным платежом. Комиссия из этой суммы повторно не вычитается. Себестоимость и налог не загружены.";
      }
      if (commission != null) {
        commissionValue = esc(money(commission));
        commissionSub = "Вознаграждение после скидки. Период отчётов: " + esc(finWindow) + ". Скидка исполнителя уже внутри этой суммы. Авансы " + esc(money(advances)) + ". Маркетинг в подвале " + esc(money(marketing)) + ": это цифра отчёта. Логистика: Нет данных.";
      }
    }
    const cards = [
      card("Заказано", pairValue(movement && movement.orderedKop, movement && movement.orderedQty), orderedSub, "#goods", "Товары"),
      card("Доставлено / реализовано в аналитике", pairValue(movement && movement.deliveredKop, movement && movement.deliveredQty), deliveredSub, "#goods", "Товары"),
      card("Возвраты", returnsValue, returnsSub, "#year", "По месяцам"),
      card("Начислено к выплате", payoutValue, payoutSub, "#year", "По месяцам", "warn"),
      cashCard(state, chosen),
      card("Комиссия и другие удержания", commissionValue, commissionSub, "#year", "По месяцам"),
    ].join("");
    const goods = movement ? movement.products : [];
    const byQty = goods.slice().sort(function (a, b) { return b.deliveredQty - a.deliveredQty || b.deliveredKop - a.deliveredKop; }).slice(0, 8);
    const brandTableNote = state.brand
      ? "<p>Фильтр бренда меняет карточки заказов, график заказов и рейтинг товаров. Таблица ниже остаётся по всему кабинету: подвал отчёта на бренд не делится.</p>"
      : "";
    return "<p class='muted'>" + esc(DATA.entity) + ". " + esc(DATA.taxNote) + " Сейчас открыт кабинет Л’Этуаль.</p>"
      + filterForm(state)
      + "<section id='period'><p class='lead' id='paid'>Крупные цифры ниже — заказы, начисления и деньги, которые уже пришли по отчётам выбранных дат.</p>"
      + "<div class='grid cards'>" + cards + "</div></section>"
      + "<h2>Графики</h2>" + orderChart(chosen, state.brand) + accrualCharts(chosen)
      + "<section id='year'><h2>Месяцы 2026</h2><div class='panel'><p>Январь 2026 на этой таблице есть: у него свой файл заказов и свой отчёт исполнителя. Свод с 1 января по 27 октября в итог не прибавляется и по месяцам не режется.</p></div>"
      + brandTableNote + yearTable(chosen) + spanCheck(state.from, state.to, movement, state.brand)
      + "<h2>Динамика</h2><div class='panel'>" + dynamics(chosen) + "<p>План не задан. Прогноз не построен: в аналитике нет подневной ленты заказов.</p></div></section>"
      + profitSection(state)
      + "<h2 id='goods'>Рейтинг товаров</h2><p class='muted'>Сложены отдельные файлы месяцев внутри выбранных дат. Сводный файл второй раз не прибавлен. Себестоимости нет, поэтому место в списке — по доставке, не по прибыли.</p>"
      + productTable(goods.slice(0, 8), "По сумме доставки") + productTable(byQty, "По количеству доставки")
      + stockBlock()
      + "<h2>Площадки и кабинеты</h2><div class='panel'><p>Сейчас заполнен один кабинет: Л’Этуаль, ИП Барская Регина Александровна. Остальные площадки на этой странице не смешаны с Л’Этуаль.</p><ul>"
      + "<li>Wildberries, кабинет ИП и кабинет ООО — не подключено. Нет данных.</li>"
      + "<li>Ozon, кабинеты ИП и ООО — не подключено. Нет данных.</li>"
      + "<li>Свой интернет-магазин — не подключено. Нет данных.</li></ul></div>"
      + receiptPanel()
      + "<div class='ask' id='ask'><p><b>Как сверены поступления.</b> Две выписки с 1 января по 29 октября 2026. Плательщик — " + esc(DATA.receipts.payer) + ". Номера счетов и платёжек на страницу не вынесены. Платёж с номером загруженного отчёта совпал со строкой «к оплате». Платёж промежуточного отчёта совпал со строкой «всего авансов» того же месяца. Отчёты декабря 2025, оплаченные уже в 2026 году, в месяцы 2026 не прибавлены. " + NO_CASH + " остаётся только там, где платежа в выписке нет.</p></div>";
  }

  function render() {
    const visible = document.getElementById("fresh-visible");
    const more = document.getElementById("fresh-more");
    const screen = document.getElementById("screen");
    if (!DATA || !DATA.months) {
      if (visible) visible.textContent = "Выгрузка не найдена";
      if (more) more.textContent = "Страница без цифр не показывается.";
      screen.innerHTML = "";
      return;
    }
    if (visible) visible.textContent = "Данные на " + DATA.asOfLabel + " · период 01.01.2026–" + dayText(DATA.asOf);
    if (more) more.textContent = DATA.freshness;
    const state = params();
    const hash = location.hash.replace(/^#/, "");
    screen.innerHTML = hash.indexOf("m/") === 0 ? renderMonth(hash.slice(2), state) : renderHome(state);
    const form = document.getElementById("period-filter");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        const next = new URLSearchParams(new FormData(form));
        history.pushState(null, "", location.pathname + "?" + next.toString() + location.hash);
        render();
      });
    }
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("popstate", render);
  render();
})();
