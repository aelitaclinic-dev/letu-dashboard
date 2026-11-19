const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");

function element(tag, text, attrs) {
  attrs = attrs || {};
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: attrs.id || "",
    classList: { contains(name) { return (attrs.className || "").split(/\s+/).includes(name); } },
    children: [],
    parentElement: null,
    textContent: text || "",
    innerText: text || "",
    attributes: Object.assign({}, attrs),
    getAttribute(name) { return this.attributes[name] == null ? null : this.attributes[name]; },
    closest(selector) {
      let current = this;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    }
  };
  return node;
}

function matches(node, selector) {
  return selector.split(",").some(function (part) {
    part = part.trim();
    if (part.charAt(0) === "#") return node.id === part.slice(1);
    if (part.charAt(0) === ".") return node.classList.contains(part.slice(1));
    if (part.indexOf("[href]") !== -1) return node.getAttribute("href") != null && node.tagName === "A";
    return node.tagName.toLowerCase() === part;
  });
}

function append(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

function documentStub() {
  const listeners = {};
  const doc = {
    readyState: "complete",
    visibilityState: "visible",
    body: element("body", ""),
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    querySelector(selector) {
      const id = selector.charAt(0) === "#" ? selector.slice(1) : "";
      const walk = node => {
        if (id && node.id === id) return node;
        for (const child of node.children || []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(doc.body);
    },
    listeners
  };
  doc.body.ownerDocument = doc;
  return doc;
}

function boot(pathname, extra) {
  const calls = [];
  const doc = documentStub();
  const form = append(doc.body, element("form", "", {id: "fluentform_3", "data-form_id": "3"}));
  const block = append(doc.body, element("div", "", {id: "price-form"}));
  append(block, form);
  const input = append(form, element("input", "", {type: "text"}));
  const header = append(doc.body, element("div", "", {"data-elementor-type": "header"}));
  const phone = append(header, element("a", "Телефон", {href: "tel:+79154920163"}));
  const email = append(doc.body, element("a", "Почта", {href: "mailto:prokerastase@yandex.ru?subject=secret"}));
  const messenger = append(doc.body, element("a", "Telegram", {href: "http://t.me/maat_distribution"}));
  const cta = append(doc.body, element("a", "Получить прайс", {href: "#price-form"}));
  const submit = append(form, element("button", "Скачать прайс", {type: "submit"}));
  const file = append(doc.body, element("a", "Скачать прайс-лист", {href: "https://maat-impera.ru/wp-content/uploads/2026/10/price.docx"}));
  const timers = [];
  const win = Object.assign({
    document: doc,
    location: {pathname: pathname, search: "?utm_source=test&token=secret"},
    ym(counter, method, goal, params) { calls.push({counter, method, goal, params}); },
    setInterval(fn) { timers.push(fn); return timers.length; },
    clearInterval() {},
    IntersectionObserver: function (callback) {
      this.observe = function () { callback([{isIntersecting: true, intersectionRatio: 0.5}]); };
      this.disconnect = function () {};
    },
    Date, URL
  }, extra || {});
  const context = {window: win, document: doc, URL, Date, module: {exports: {}}, globalThis: win};
  win.window = win;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("site-analytics/wordpress/maat-metrika-goals/assets/goals.js", "utf8"), context);
  const api = win.MaatMetrikaGoals;
  const handle = api.start(win, {formId: 3, auto: false});
  return {api, win, doc, calls, handle, nodes: {form, input, phone, email, messenger, cta, submit, file}};
}

const home = boot("/");
assert.equal(home.api.COUNTER, 99820405);
assert.equal(home.calls.some(call => call.goal === "price_block_view" && call.params.place === "форма прайса"), true);
assert.equal(home.calls.some(call => call.goal === "contacts_view"), false);
home.doc.listeners.click[0]({target: home.nodes.phone});
home.doc.listeners.click[0]({target: home.nodes.phone});
home.doc.listeners.click[0]({target: home.nodes.email});
home.doc.listeners.click[0]({target: home.nodes.messenger});
home.doc.listeners.click[0]({target: home.nodes.cta});
home.doc.listeners.click[0]({target: home.nodes.submit});
home.doc.listeners.click[0]({target: home.nodes.file});
home.doc.listeners.focusin[0]({target: home.nodes.input});
home.doc.listeners.focusin[0]({target: home.nodes.input});
const goals = home.calls.map(call => call.goal);
assert.equal(goals.filter(goal => goal === "contact_phone_click").length, 1);
assert.equal(goals.includes("contact_email_click"), true);
assert.equal(goals.includes("contact_messenger_click"), true);
assert.equal(goals.includes("price_cta_click"), true);
assert.equal(goals.includes("price_form_start"), true);
assert.equal(goals.includes("price_download_click"), true);
assert.equal(goals.includes("price_form_success"), false);
home.calls.forEach(call => {
  assert.equal(call.counter, 99820405);
  assert.equal(call.params.page, "/");
  assert.equal(JSON.stringify(call.params).includes("token"), false);
  assert.equal(JSON.stringify(call.params).includes("prokerastase"), false);
  assert.equal(JSON.stringify(call.params).includes("7915"), false);
});

home.handle.onSuccess({config: {id: 3}, response: {data: {errors: {name: "заполните"}}}});
home.handle.onSuccess({config: {id: 3}, response: {data: {result: {redirectUrl: "/price_download/"}}}});
home.handle.onSuccess({config: {id: 3}, response: {data: {result: {message: "ok"}}}});
assert.equal(home.calls.filter(call => call.goal === "price_form_success").length, 1);
home.handle.onSuccess({config: {id: 9}, response: {data: {result: {message: "ok"}}}});
assert.equal(home.calls.filter(call => call.goal === "price_form_success").length, 1);

const contacts = boot("/contacs/");
assert.equal(contacts.calls.some(call => call.goal === "contacts_view" && call.params.page === "/contacs"), true);

home.doc.visibilityState = "hidden";
home.handle.tick(1_000);
home.doc.visibilityState = "visible";
home.handle.tick(16_000);
home.handle.tick(31_000);
home.handle.tick(61_000);
assert.deepEqual(home.calls.filter(call => String(call.goal).startsWith("engage_")).map(call => call.goal), ["engage_15_home", "engage_30_home", "engage_60_home"]);

const hidden = boot("/professional-hair-care/");
hidden.doc.visibilityState = "hidden";
hidden.handle.tick(0);
hidden.handle.tick(70_000);
assert.equal(hidden.calls.some(call => String(call.goal).startsWith("engage_")), false);

assert.equal(home.api.classifyContact("https://max.ru/channel_maat_distribution"), "contact_messenger_click");
assert.equal(home.api.pageGroup("/product/item"), "product");
assert.equal(home.api.sanitizePath("/contacs/?email=a@b.c"), "/contacs");
console.log("Metrika goals: form success, dedupe, contacts and visible time passed");
