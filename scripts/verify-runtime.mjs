import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const root = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const clientSrc = fs.readFileSync(path.join(root, "lib", "client.js"), "utf8");

// ---- minimal DOM/window mocks ----
// A flat body: text nodes are direct children, so the tree walker only has to
// honour acceptNode (FILTER_ACCEPT = 1).
function makeTextNode(value) { return { nodeType: 3, nodeValue: value, parentElement: null }; }
const documentMock = {
  documentElement: { lang: "en", dir: "ltr" },
  body: { nodeType: 1, childNodes: [], matches: () => false, parentElement: null },
  createTreeWalker(root, _what, filter) {
    const nodes = [...(root.childNodes ?? [])];
    let i = 0;
    return {
      nextNode: () => {
        while (i < nodes.length) {
          const n = nodes[i++];
          if (!filter || filter.acceptNode(n) === 1) return n;
        }
        return null;
      },
    };
  },
};
// Timers run only when the test says so.
const timers = [];
const runTimers = () => { while (timers.length) timers.shift()(); };
const settle = async () => {
  for (let round = 0; round < 10; round++) {
    runTimers();
    for (let k = 0; k < 5; k++) await Promise.resolve();
  }
};
class MutationObserverMock {
  constructor(cb) { this.cb = cb; MutationObserverMock.last = this; }
  observe() {}
  disconnect() {}
}
const localStorageMock = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
})();
const win = {
  __ModuleLoader__: { load: (spec) => { win.__spec = spec; } },
  localStorage: localStorageMock,
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
};

const sandbox = {
  window: win,
  document: documentMock,
  NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
  MutationObserver: MutationObserverMock,
  console: { ...console, warn: () => {}, info: () => {} },
};
win.document = documentMock;
vm.createContext(sandbox);
vm.runInContext(clientSrc, sandbox);
const spec = win.__spec;
if (!spec || spec.id !== pkg.name || typeof spec.factory !== "function") {
  console.error(`FAIL: bundle registered ${JSON.stringify(spec?.id)} instead of ${JSON.stringify(pkg.name)}`);
  process.exit(1);
}
const mod = spec.factory(() => { throw new Error("require not used"); });
if (!mod || typeof mod.apply !== "function") { console.error("FAIL: no apply"); process.exit(1); }

// ---- faithful locale-service mock (mirrors dsh-client-locale 0.2.0-rc.2) ----
const localeKey = (v) => String(v).toLowerCase();
const dicts = new Map(); // ns -> Map(langKey -> dict)
const catalog = new Map([
  ["zh", { id: "zh", label: "中文", fallback: "en" }],
  ["en", { id: "en", label: "English" }],
]);
const locale = {
  dicts,
  state: {
    active: "en",
    locales: [{ id: "en", label: "English" }, { id: "zh", label: "中文" }],
    revision: 1,
  },
  addLanguage(input) {
    const key = localeKey(input.id);
    if (catalog.has(key)) throw new Error(`locale "${input.id}" is already registered`);
    if (!catalog.has(localeKey(input.fallback))) throw new Error(`locale fallback "${input.fallback}" is not registered`);
    const language = Object.freeze({ id: input.id, label: input.label, fallback: input.fallback });
    catalog.set(key, language);
    this.state = {
      ...this.state,
      locales: [...catalog.values()],
      revision: this.state.revision + 1,
    };
    return () => {
      catalog.delete(key);
      this.state = { ...this.state, locales: [...catalog.values()], revision: this.state.revision + 1 };
    };
  },
  register(ns, lang, dict) {
    if (!dicts.has(ns)) dicts.set(ns, new Map());
    dicts.get(ns).set(localeKey(lang), dict);
  },
  getLocale() { return this.state; },
  publish(id, force, locales) {
    this.state = {
      ...this.state,
      active: id,
      locales: locales ?? this.state.locales,
      revision: this.state.revision + 1,
    };
  },
  setLocale(id) {
    const match = catalog.get(localeKey(id));
    if (!match) throw new Error(`locale "${id}" is not registered`);
    this.publish(match.id, true);
  },
  translate(ns, key, params) {
    const active = this.state.active;
    const dict = this.dicts.get(ns)?.get(localeKey(active)) ?? this.dicts.get("common")?.get(localeKey(active));
    if (!dict || dict[key] === undefined) return key;
    let v = dict[key];
    if (params) v = v.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m));
    return v;
  },
  adopt(host) {},
};

// Host translate route: "IT:" + text, or a scripted failure / deferred answer.
const rpc = { calls: [], mode: "ok", deferred: [] };
const answer = (payload) => ({ ok: true, value: { translations: payload.texts.map((t) => "IT:" + t) } });
const connection = {
  rpc: {
    call(_path, method, payload) {
      rpc.calls.push({ method, payload });
      if (rpc.mode === "fail") return Promise.resolve({ ok: false, error: { message: "no model route" } });
      if (rpc.mode === "defer") return new Promise((resolve) => rpc.deferred.push(() => resolve(answer(payload))));
      return Promise.resolve(answer(payload));
    },
  },
};

const effects = [];
const ctx = {
  get: (k) => (k === "locale" ? locale : k === "connection" ? connection : undefined),
  effect: (fn) => {
    const dispose = fn();
    if (typeof dispose === "function") effects.push(dispose);
    return dispose;
  },
};

// ---- run apply ----
mod.apply(ctx);

let failures = 0;
const ok = (cond, name, detail = "") => { if (cond) console.log("PASS " + name); else { failures++; console.log("FAIL " + name + (detail ? ": " + detail : "")); } };

ok(Array.isArray(mod.inject) && mod.inject.includes("locale"), "inject includes locale", JSON.stringify(mod.inject));
ok(clientSrc.includes(pkg.version), "bundle embeds version " + pkg.version);
ok(clientSrc.includes("browserLocaleId"), "bundle can seed from browser locale");
ok(clientSrc.includes("addLanguage"), "bundle uses addLanguage");
ok(clientSrc.includes("localeKey"), "bundle uses localeKey for dict lookups");

// 1) every registry locale is in the catalog with a full dictionary
const { locales } = await import(pathToFileURL(path.join(root, "scripts", "locales.mjs")).href);
// Expected key count comes from the English baseline, so a re-extraction needs no edit here.
const EXPECTED_KEYS = fs.readdirSync(path.join(root, "src", "en"))
  .filter((f) => f.endsWith(".json"))
  .reduce((n, f) => n + JSON.parse(fs.readFileSync(path.join(root, "src", "en", f), "utf8"))
    .entries.reduce((m, e) => m + Object.keys(e.dict).length, 0), 0);
ok(EXPECTED_KEYS > 0, "English baseline has keys", String(EXPECTED_KEYS));
for (const L of locales) {
  ok(catalog.has(localeKey(L.id)), "catalog has " + L.id);
  let keys = 0;
  for (const nsMap of dicts.values()) keys += Object.keys(nsMap.get(localeKey(L.id)) ?? {}).length;
  ok(keys === EXPECTED_KEYS, "locale " + L.id + " registers " + EXPECTED_KEYS + " keys", "got " + keys);
}
ok(catalog.get("it")?.fallback === "en", "it falls back to en", JSON.stringify(catalog.get("it")));
ok(clientSrc.includes("characterData: false"), "observers omit characterData");
ok(!clientSrc.includes("characterData: true"), "no characterData:true observers");
ok(clientSrc.includes("[data-conversation-scroll]"), "skip conversation scrollport");
ok(clientSrc.includes("[data-team-panel]"), "skip AgentTeams panel");
ok(!clientSrc.includes("[data-agent-teams-panel-open]"), "old AgentTeams selector removed");

// 2) curated translate under it (case-insensitive dict keys)
locale.setLocale("it");
ok(locale.getLocale().active === "it", "setLocale accepts it from catalog");
ok(documentMock.documentElement.lang === "it", "document lang is it", documentMock.documentElement.lang);
const itSample = locale.translate("settings.locale", "language.title");
ok(typeof itSample === "string" && itSample.length > 0 && itSample !== "language.title", "translate returns curated string under it", JSON.stringify(itSample));

// 3) a key missing from the it dictionary falls back to English
dicts.set("fallback.test", new Map([["en", { "only.en": "English only {n}" }]]));
ok(locale.translate("fallback.test", "only.en", { n: 2 }) === "English only 2", "missing it key falls back to en", JSON.stringify(locale.translate("fallback.test", "only.en", { n: 2 })));

// 4) unknown key graceful
const unknown = locale.translate("nonexistent.ns", "no.such.key");
ok(unknown === "no.such.key", "unknown key returns key itself", JSON.stringify(unknown));

// 5) preference round-trip survives adopt
locale.setLocale("en");
localStorageMock.setItem("dsh-i18n.preference", "it");
locale.adopt({});
ok(locale.getLocale().active === "it", "adopt re-asserts localStorage preference", locale.getLocale().active);

// 6) auto-translate: translate, skip own output, restore on language switch
const SENTENCE = "This plugin adds a sidebar entry that lists every note in the workspace.";
const SENTENCE2 = "Choose a model provider before you start a new conversation in this workspace.";
const SENTENCE3 = "The selected provider did not answer, so the request will be tried again shortly.";
const t1 = makeTextNode(SENTENCE);
documentMock.body.childNodes.push(t1);
locale.setLocale("en");
locale.setLocale("it");        // starts the MT observer, which walks the body
await settle();
ok(rpc.calls.length === 1 && rpc.calls[0].method === "dsh-i18n.translate", "MT sends one translate call", String(rpc.calls.length));
ok(rpc.calls[0]?.payload.targetLang === "Italiano", "MT targets Italiano", JSON.stringify(rpc.calls[0]?.payload.targetLang));
ok(t1.nodeValue === "IT:" + SENTENCE, "MT writes the translation into the node", JSON.stringify(t1.nodeValue));

MutationObserverMock.last.cb([{ type: "childList", addedNodes: [t1] }]);
await settle();
ok(rpc.calls.length === 1, "MT does not send its own translation back to the model", String(rpc.calls.length));

locale.setLocale("en");
ok(t1.nodeValue === SENTENCE, "switching to en restores the English text", JSON.stringify(t1.nodeValue));
locale.setLocale("it");
await settle();
ok(t1.nodeValue === "IT:" + SENTENCE && rpc.calls.length === 1, "switching back reuses the cache", t1.nodeValue + " / " + rpc.calls.length);

// 7) a text already in flight is not sent twice
rpc.mode = "defer";
const t2 = makeTextNode(SENTENCE2);
documentMock.body.childNodes.push(t2);
MutationObserverMock.last.cb([{ type: "childList", addedNodes: [t2] }]);
await settle();
MutationObserverMock.last.cb([{ type: "childList", addedNodes: [t2] }]);
await settle();
ok(rpc.calls.length === 2, "in-flight text is not queued again", String(rpc.calls.length));
for (const resolve of rpc.deferred.splice(0)) resolve();
await settle();
ok(t2.nodeValue === "IT:" + SENTENCE2, "deferred answer is applied", JSON.stringify(t2.nodeValue));

// 8) failures are retried a bounded number of times
rpc.mode = "fail";
const t3 = makeTextNode(SENTENCE3);
documentMock.body.childNodes.push(t3);
MutationObserverMock.last.cb([{ type: "childList", addedNodes: [t3] }]);
await settle();
await settle();
const failedCalls = rpc.calls.filter((c) => c.payload.texts.includes(SENTENCE3)).length;
ok(failedCalls === 3, "failed text is tried once plus 2 retries", String(failedCalls));
ok(t3.nodeValue === SENTENCE3, "failed text stays in English", JSON.stringify(t3.nodeValue));

console.log(failures === 0 ? "ALL PASS" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
