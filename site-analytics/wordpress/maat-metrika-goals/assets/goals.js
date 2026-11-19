/* Цели счётчика 99820405. Второй счётчик не создаётся. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  var target = root || (typeof globalThis !== "undefined" ? globalThis : {});
  target.MaatMetrikaGoals = api;
  var config = target.MAAT_METRIKA;
  if (config && config.auto !== false && target.document) {
    var boot = function () { api.start(target, config); };
    if (target.document.readyState === "loading") target.document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  var COUNTER = 99820405;
  var FORM_ID = "3";
  var PLACES = { header: "шапка", footer: "футер", form: "форма прайса", page: "страница", download: "страница скачивания" };

  function sanitizePath(pathname) {
    var path = String(pathname || "/").split("?")[0].split("#")[0];
    if (path.charAt(0) !== "/") path = "/" + path;
    path = path.replace(/\/{2,}/g, "/");
    if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
    if (path.length > 180 || /[@]|token|email|phone|\d{6,}/i.test(path)) return "/";
    return path || "/";
  }

  function pageGroup(pathname) {
    var path = sanitizePath(pathname);
    if (path === "/") return "home";
    if (path.indexOf("/professional-hair-care") === 0) return "catalog";
    if (path.indexOf("/sinko-styling") === 0) return "sinko";
    if (path.indexOf("/product/") === 0) return "product";
    if (path === "/contacs") return "contacts";
    return "";
  }

  function classifyContact(href) {
    var raw = String(href || "").trim();
    if (!raw) return "";
    var lower = raw.toLowerCase();
    if (lower.indexOf("tel:") === 0) return "contact_phone_click";
    if (lower.indexOf("mailto:") === 0) return "contact_email_click";
    var host = "";
    try {
      host = new URL(raw, "https://maat-impera.ru").hostname.toLowerCase().replace(/^www\./, "");
    } catch (error) {
      return "";
    }
    var messengers = ["t.me", "telegram.me", "telegram.dog", "wa.me", "whatsapp.com", "api.whatsapp.com", "max.ru", "vk.com", "vk.me", "ok.ru", "instagram.com", "facebook.com", "fb.com"];
    for (var i = 0; i < messengers.length; i++) {
      if (host === messengers[i] || host.slice(-(messengers[i].length + 1)) === "." + messengers[i]) return "contact_messenger_click";
    }
    return "";
  }

  function goalParams(path, place) {
    if (!PLACES[place] && ["шапка", "футер", "форма прайса", "страница", "страница скачивания"].indexOf(place) === -1) place = "страница";
    var page = sanitizePath(path);
    var safePlace = PLACES[place] || place;
    return { page: page, place: safePlace };
  }

  function elementText(node) {
    if (!node) return "";
    return String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function placeOf(node, path) {
    var current = node;
    while (current && current.nodeType === 1) {
      if (current.id === "fluentform_3" || current.id === "price-form" || current.classList && current.classList.contains("fluentform_wrapper_3")) return "form";
      var kind = current.getAttribute && current.getAttribute("data-elementor-type");
      if (kind === "header") return "header";
      if (kind === "footer") return "footer";
      current = current.parentElement || current.parentNode;
    }
    if (sanitizePath(path) === "/price_download") return "download";
    return "page";
  }

  function formIdOf(payload) {
    payload = payload || {};
    var config = payload.config || {};
    if (config.id != null && config.id !== "") return String(config.id);
    var form = payload.form;
    if (form && form.jquery) form = form[0];
    if (form && form.getAttribute) return String(form.getAttribute("data-form_id") || "");
    return "";
  }

  function confirmedResult(payload) {
    var response = payload && payload.response;
    return !!(response && response.data && response.data.result);
  }

  function isPriceCta(node) {
    var control = node && node.closest ? node.closest("a, button") : null;
    if (!control) return false;
    if (control.closest && control.closest("#fluentform_3")) return false;
    var text = elementText(control).toLocaleLowerCase("ru");
    return text === "получить прайс" || text === "получить прайс-лист";
  }

  function isPriceFileLink(node) {
    var link = node && node.closest ? node.closest("a[href]") : null;
    if (!link) return false;
    var href = String(link.getAttribute("href") || "");
    var text = elementText(link).toLocaleLowerCase("ru");
    var file = false;
    try {
      var url = new URL(href, "https://maat-impera.ru");
      file = /\/wp-content\/uploads\//.test(url.pathname) && /\.(docx|pdf|xlsx|xls)(?:$)/i.test(decodeURIComponent(url.pathname));
    } catch (error) {
      file = false;
    }
    return file && (text.indexOf("прайс") !== -1 || text.indexOf("скачать") !== -1);
  }

  function start(win, config) {
    config = config || {};
    var formId = String(config.formId || FORM_ID);
    var doc = win.document;
    var sent = Object.create(null);
    var visibleMs = 0;
    var lastTick = null;
    var engaged = Object.create(null);
    var stopped = false;

    function reach(goal, place, identity) {
      var path = sanitizePath(win.location && win.location.pathname);
      var params = goalParams(path, place);
      var key = goal + "|" + params.page + "|" + params.place + "|" + String(identity || "");
      if (sent[key]) return false;
      sent[key] = true;
      if (typeof win.ym === "function") win.ym(COUNTER, "reachGoal", goal, { page: params.page, place: params.place });
      return true;
    }

    function onSuccess(payload) {
      if (formIdOf(payload) !== formId || !confirmedResult(payload)) return false;
      return reach("price_form_success", "form");
    }

    function onClick(event) {
      var node = event.target;
      if (isPriceCta(node)) {
        reach("price_cta_click", placeOf(node, win.location.pathname));
        return;
      }
      if (isPriceFileLink(node)) {
        reach("price_download_click", placeOf(node, win.location.pathname));
        return;
      }
      var link = node && node.closest ? node.closest("a[href]") : null;
      if (!link) return;
      var goal = classifyContact(link.getAttribute("href"));
      if (goal) reach(goal, placeOf(link, win.location.pathname), link.getAttribute("href"));
    }

    function onFocus(event) {
      var node = event.target;
      if (!node || !node.closest || !node.closest("#fluentform_3, .fluentform_wrapper_3")) return;
      var tag = String(node.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].indexOf(tag) === -1) return;
      var type = String(node.getAttribute("type") || "").toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") return;
      reach("price_form_start", "form");
    }

    function tick(now) {
      if (stopped) return visibleMs;
      var group = pageGroup(win.location && win.location.pathname);
      if (!group) return visibleMs;
      now = now == null ? Date.now() : now;
      var visible = !doc.visibilityState || doc.visibilityState === "visible";
      if (lastTick != null && visible) visibleMs += Math.max(0, now - lastTick);
      lastTick = now;
      [15, 30, 60].forEach(function (seconds) {
        var goal = "engage_" + seconds + "_" + group;
        if (!engaged[goal] && visibleMs >= seconds * 1000) {
          engaged[goal] = true;
          reach(goal, "page");
        }
      });
      return visibleMs;
    }

    if (pageGroup(win.location && win.location.pathname) === "contacts") reach("contacts_view", "page");

    var block = doc.querySelector && (doc.querySelector("#price-form") || doc.querySelector("#fluentform_3"));
    var observer = null;
    if (block && typeof win.IntersectionObserver === "function") {
      observer = new win.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            reach("price_block_view", "form");
            observer.disconnect();
          }
        });
      }, { threshold: [0.35] });
      observer.observe(block);
    }

    doc.addEventListener("click", onClick, true);
    doc.addEventListener("focusin", onFocus, true);
    doc.addEventListener("fluentform_submission_success", function (event) { onSuccess(event && event.detail); });
    var jqueryTries = 0;
    var jqueryTimer = win.setInterval(function () {
      jqueryTries += 1;
      if (win.jQuery && win.jQuery(doc.body).on) {
        win.jQuery(doc.body).on("fluentform_submission_success", function (_event, data) { onSuccess(data); });
        win.clearInterval(jqueryTimer);
      } else if (jqueryTries > 20) win.clearInterval(jqueryTimer);
    }, 500);
    var timer = win.setInterval(function () { tick(); }, 1000);
    doc.addEventListener("visibilitychange", function () { tick(); });

    return {
      tick: tick,
      onSuccess: onSuccess,
      stop: function () {
        stopped = true;
        win.clearInterval(timer);
        win.clearInterval(jqueryTimer);
        if (observer) observer.disconnect();
      }
    };
  }

  return {
    COUNTER: COUNTER,
    start: start,
    sanitizePath: sanitizePath,
    pageGroup: pageGroup,
    classifyContact: classifyContact,
    goalParams: goalParams,
    placeOf: placeOf,
    formIdOf: formIdOf,
    confirmedResult: confirmedResult,
    isPriceCta: isPriceCta,
    isPriceFileLink: isPriceFileLink
  };
});
