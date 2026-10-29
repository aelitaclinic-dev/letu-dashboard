(function () {
  function num(node) {
    if (!node) return null;
    const text = String(node.value == null ? "" : node.value).trim().replace(",", ".");
    if (text === "") return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function textOf(node) {
    if (!node) return "";
    return String(node.value || "").trim();
  }

  function money(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const sign = value < 0 ? "−" : "";
    const rounded = Math.round(Math.abs(value) * 100) / 100;
    const whole = Math.trunc(rounded);
    const frac = Math.round((rounded - whole) * 100);
    const groups = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    if (frac === 0) return sign + groups + " ₽";
    return sign + groups + "," + String(frac).padStart(2, "0") + " ₽";
  }

  function percent(value) {
    if (value == null) return "—";
    const shown = Math.round(value * 10000) / 100;
    return String(shown).replace(".", ",") + "%";
  }

  function setText(row, cls, value) {
    const node = row.querySelector("." + cls);
    if (node) node.textContent = value;
  }

  function recalcUnit() {
    const taxPercent = num(document.getElementById("unit-tax-percent"));
    const taxRate = taxPercent == null ? null : taxPercent / 100;
    document.querySelectorAll("#unit tr.unit-sku").forEach(function (row) {
      const base = num(row.querySelector(".u-base"));
      const label = num(row.querySelector(".u-label"));
      const box = num(row.querySelector(".u-box"));
      const period = num(row.querySelector(".u-period"));
      const qty = num(row.querySelector(".u-qty"));
      const direct = num(row.querySelector(".u-direct"));
      const materials = num(row.querySelector(".u-materials"));
      const price = num(row.querySelector(".u-price"));
      const kind = textOf(row.querySelector(".u-kind"));
      const ratePercent = num(row.querySelector(".u-rate"));
      const rate = ratePercent == null ? null : ratePercent / 100;
      const logistics = num(row.querySelector(".u-logistics"));
      const reserveRub = num(row.querySelector(".u-reserve-rub"));
      const reservePercent = num(row.querySelector(".u-reserve-pct"));
      const reserveBaseName = textOf(row.querySelector(".u-reserve-base"));
      let packer = null;
      if (direct != null) packer = Math.round(direct * 100) / 100;
      else if (period != null && qty) packer = Math.round((period / qty) * 100) / 100;
      let prep = null;
      if (label != null && box != null && packer != null && materials != null) {
        prep = Math.round((label + box + packer + materials) * 100) / 100;
      }
      let withPrep = null;
      if (base != null && prep != null) withPrep = Math.round((base + prep) * 100) / 100;
      let commission = null;
      if (price != null && rate != null) commission = Math.round(price * rate * 100) / 100;
      let tax = null;
      if (price != null && taxRate != null) tax = Math.round(price * taxRate * 100) / 100;
      let result = null;
      if (price != null && withPrep != null && commission != null && logistics != null && tax != null) {
        result = Math.round((price - withPrep - commission - logistics - tax) * 100) / 100;
      }
      let reserveBase = null;
      if (reserveBaseName === "Исходная себестоимость") reserveBase = base;
      else if (reserveBaseName === "Стоимость с подготовкой") reserveBase = withPrep;
      else if (reserveBaseName === "Цена продажи Л’Этуаль") reserveBase = price;
      let reserve = null;
      if (reserveRub != null) reserve = Math.round(reserveRub * 100) / 100;
      else if (reservePercent != null && reserveBase != null) {
        reserve = Math.round(reserveBase * (reservePercent / 100) * 100) / 100;
      }
      let after = null;
      if (result != null && reserve != null) after = Math.round((result - reserve) * 100) / 100;
      const ros = after != null && price ? after / price : null;
      const gaps = [];
      if (label == null) gaps.push("этикетка");
      if (box == null) gaps.push("коробочка");
      if (packer == null) gaps.push("работа упаковщика");
      if (materials == null) gaps.push("другие расходные материалы");
      if (price == null) gaps.push("цена продажи");
      if (!kind) gaps.push("пометка цены: фактическая или плановая");
      if (rate == null) gaps.push("ставка комиссии");
      if (logistics == null) gaps.push("логистика площадки");
      if (reserve == null) gaps.push("плановый резерв");
      const note = row.getAttribute("data-rate-note") || "";
      const tail = note ? " " + note : "";
      const missing = gaps.length
        ? "Не хватает: " + gaps.join("; ") + "." + tail
        : "По этим полям пустых нет. Сертификация, маркировка, склад, фулфилмент, доставка до склада маркетплейса, реклама, эквайринг, возвраты и прочие расходы в результат не входят." + tail;
      setText(row, "u-packer", money(packer));
      setText(row, "u-prep", money(prep));
      setText(row, "u-with", money(withPrep));
      setText(row, "u-commission", money(commission));
      setText(row, "u-tax", money(tax));
      setText(row, "u-result", money(result));
      setText(row, "u-reserve", money(reserve));
      setText(row, "u-after", money(after));
      setText(row, "u-ros", percent(ros));
      setText(row, "u-missing", missing);
    });
  }

  window.recalcUnit = recalcUnit;
  document.addEventListener("input", function (event) {
    if (event.target.closest && event.target.closest("#unit")) recalcUnit();
  });
  document.addEventListener("change", function (event) {
    if (event.target.closest && event.target.closest("#unit")) recalcUnit();
  });
  if (document.getElementById("unit")) recalcUnit();
})();
