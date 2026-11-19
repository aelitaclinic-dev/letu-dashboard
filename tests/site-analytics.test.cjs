const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");

const published = JSON.parse(fs.readFileSync("site-analytics/published.json", "utf8"));
assert.equal(published.live, false);
assert.equal(published.history.length, 0);
assert.equal(published.counterId, 99820405);
assert.equal(JSON.stringify(published).includes("тестовые цифры"), false);
assert.match(published.notice, /не подставлены/);
assert.equal(published.messenger.tracked, false);

const context = {
  location: {hostname: "localhost", hash: "#site"},
  fetch: () => new Promise(() => {}),
  window: {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("site.js", "utf8"), context);
const waiting = context.SiteAnalytics.renderData(published);
assert.match(waiting, /Отчёта с цифрами ещё нет/);
assert.match(waiting, /price_form_success/);
assert.match(waiting, /Рекомендация мастера/);
assert.equal(waiting.includes("0 визитов"), false);

const sample = context.SiteAnalytics.renderData({
  schemaVersion: 1,
  counterId: 99820405,
  history: [{sample: true, totals: {visits: 99}}]
});
assert.match(sample, /Это не статистика сайта/);
assert.equal(sample.includes(">99<"), false);

const live = context.SiteAnalytics.renderData({
  schemaVersion: 1,
  counterId: 99820405,
  goals: published.goals,
  messenger: published.messenger,
  history: [{
    sample: false,
    period: {start: "2026-11-17", end: "2026-11-18"},
    previousPeriod: {start: "2026-11-15", end: "2026-11-16"},
    totals: {users: 3, visits: 4, pageviews: 8},
    sources: [{label: "Прямые визиты", visits: 4, previous: 1}],
    entrances: [{url: "https://maat-impera.ru/", visits: 2}],
    sequences: {available: false, reason: "Журнал просмотров недоступен."},
    pages: [{label: "Главная", visits: 2, pageviews: 3, note: "Долю не делю."}],
    visitDuration: {label: "Средняя длительность визита", seconds: 75, previousSeconds: 40},
    engagement: {label: "Оценка вовлечённости", note: "Это не длительность визита.", rows: []},
    funnel: {mode: "separate_goal_totals", note: "Долю не делю.", stages: [{id: "price_form_success", label: "Отправили заявку", visits: null, error: "Цель не создана."}], separate: []},
    contacts: {page: {visits: null, reaches: null, error: "Цель не создана."}},
    conclusions: ["Визиты: 4 против 1 за предыдущие два дня, на 3 больше."]
  }]
});
assert.match(live, /4 против 1/);
assert.match(live, /Средняя длительность визита/);
assert.match(live, /Это не длительность визита/);
assert.match(live, /Долю не делю/);
assert.match(live, /1 мин 15 с/);

const html = fs.readFileSync("index.html", "utf8");
assert.match(html, /href="#site"/);
assert.match(html, /site\.js/);
const app = fs.readFileSync("app.js", "utf8");
assert.match(app, /hash === "site"/);
assert.match(app, /SiteAnalytics/);
console.log("Site analytics page: waiting state, sample banner and route passed");
