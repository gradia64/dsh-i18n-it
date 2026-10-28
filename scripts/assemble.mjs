// assemble.mjs — genera lib/client.js da src/<lang>/*.json (dizionari + logica del plugin)
// 用法: node scripts/assemble.mjs
import fs from "node:fs";
import path from "node:path";
import { locales } from "./locales.mjs";

const root = path.join(import.meta.dirname, "..");
const outFile = path.join(root, "lib", "client.js");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
// DSH client-modules keys the graph row by package.json "name". Registering
// the old unscoped id ("dsh-i18n") makes Desktop fail the whole plugin table:
// bundle loaded without registering "@mimateinn/dsh-i18n" via __ModuleLoader__.load
const CLIENT_MODULE_ID = pkg.name;
if (typeof CLIENT_MODULE_ID !== "string" || CLIENT_MODULE_ID.length === 0) {
  throw new Error("package.json name is required as the ModuleLoader id");
}

// Registro lingue: dir è la cartella in src/, id il locale id, label l'etichetta nella riga Lingua.
// Le chiavi senza traduzione ricadono sull'inglese (il dizionario en è registrato da DSH).
const LANGUAGES = locales.map(({ id, dir, label }) => ({ id, dir, label }));

const dicts = {}; // langId -> { ns -> dict }
for (const lang of LANGUAGES) {
  const langDir = path.join(root, "src", lang.dir);
  if (!fs.existsSync(langDir)) throw new Error(`missing src/${lang.dir}/`);
  const files = fs.readdirSync(langDir).filter((f) => f.endsWith(".json")).sort();
  const perLang = {};
  let keys = 0;
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(langDir, f), "utf8"));
    for (const entry of data.entries) {
      if (perLang[entry.ns]) throw new Error(`duplicate ns ${entry.ns} in ${f}`);
      perLang[entry.ns] = entry.dict;
      keys += Object.keys(entry.dict).length;
    }
  }
  dicts[lang.id] = perLang;
  console.log(`  ${lang.id} (${lang.dir}): ${files.length} files, ${keys} keys`);
}

const LANGUAGES_JSON = JSON.stringify(LANGUAGES.map(({ id, label }) => ({ id, label })));
const DICTS_JSON = JSON.stringify(dicts);

const clientJs = `/* global window */
// lib/client.js — bundle Browser di dsh-i18n-it (factory CJS scritta a mano, iniettata
// dal ModuleLoader del client web DSH). Generato da scripts/assemble.mjs: non modificare.
//
// Compiti:
//  1. registra il dizionario italiano per tutti i namespace del locale, tradotto voce per
//     voce dalla base inglese; segue la lingua scelta nelle impostazioni di DSH;
//  2. fallback: le chiavi senza traduzione (stringhe nuove di DSH, plugin di terzi)
//     mostrano l'inglese;
//  3. aggiunge l'italiano alla riga Lingua delle impostazioni;
//  4. salva la scelta in localStorage, così resta dopo il ricaricamento;
//  5. traduzione automatica via modello del testo inglese lungo non coperto dal dizionario.
//
// Dipendenze iniettate: @deepseek-ai/dsh-client-locale (servizio locale); se manca, il
// plugin si disattiva in silenzio senza toccare gli altri plugin.
window.__ModuleLoader__.load({
  id: ${JSON.stringify(CLIENT_MODULE_ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const LANGUAGES = ${LANGUAGES_JSON};
    const STORAGE_KEY = "dsh-i18n.preference";
    // 舊包名遷移鏈：dsh-multi-lang-ui → dsh-zh-tw-ui → dsh-locale-zh-tw
    const LEGACY_STORAGE_KEYS = ["dsh-multi-lang-ui.preference", "dsh-zh-tw-ui.preference", "dsh-locale-zh-tw.preference"];

    // Dizionari tradotti (generati da scripts/assemble.mjs)
    const DICTS = ${DICTS_JSON};

    const name = "dsh-i18n";
    const PLUGIN_VERSION = ${JSON.stringify(pkg.version)};
    // locale is required for dictionary registration; connection is optional for LLM auto-MT.
    const inject = ["locale", "connection"];

    // Match dsh-client-locale's case-insensitive Map key (value.toLowerCase()).
    function localeKey(value) {
      return String(value).toLowerCase();
    }

    function applyParams(template, params) {
      if (!params) return template;
      return template.replace(/\\{(\\w+)\\}/g, (match, name) => name in params ? String(params[name]) : match);
    }

    function dictLookup(dicts, ns, langId, key) {
      if (!dicts || typeof dicts.get !== "function") return undefined;
      const locales = dicts.get(ns);
      if (!locales || typeof locales.get !== "function") return undefined;
      return locales.get(localeKey(langId))?.[key];
    }

    function readPref() {
      try {
        let value = window.localStorage.getItem(STORAGE_KEY);
        if (value === null) {
          for (const legacy of LEGACY_STORAGE_KEYS) {
            const old = window.localStorage.getItem(legacy);
            if (old !== null) {
              window.localStorage.setItem(STORAGE_KEY, old);
              window.localStorage.removeItem(legacy);
              value = old;
              break;
            }
          }
        }
        return value;
      } catch { return null; }
    }
    function writePref(value) {
      try {
        if (value === null || value === undefined) window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, value);
        for (const legacy of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(legacy);
      } catch { /* 隐私模式等：忽略，语言选择在本次会话内生效 */ }
    }
    // Exact browser tag only (it, not it-CH). First launch with no saved choice.
    function browserLocaleId() {
      try {
        const nav = typeof navigator !== "undefined" ? navigator : null;
        if (!nav) return null;
        const tags = [];
        if (nav.languages && typeof nav.languages[Symbol.iterator] === "function") tags.push(...nav.languages);
        if (nav.language) tags.push(nav.language);
        for (const tag of tags) {
          const hit = LANGUAGES.find((l) => localeKey(l.id) === localeKey(tag));
          if (hit) return hit.id;
        }
      } catch { /* ignore */ }
      return null;
    }

    // ---- Superfici da non toccare ----
    // Conversation / composer / AgentTeams live surfaces stream token text as
    // characterData. Walking those on every token stalls the renderer so the
    // model keeps running while glyphs never paint. Skip them in the auto-translate
    // observer; chrome/settings are still handled via childList.
    const DOM_SKIP_SELECTOR = "input, textarea, select, [contenteditable], pre, code, script, style, [data-conversation-scroll], [data-composer-input], [data-composer-card], [data-composer-seat], [data-team-id], [data-team-panel], [data-team-action], [data-recovery], [data-renderer-recovery], [data-boot-recovery]";
    let domRaf = 0;
    let domQueued = null;

    function closestMatches(node, selector) {
      let el = node.nodeType === 1 ? node : node.parentElement;
      while (el) {
        if (el.matches && el.matches(selector)) return true;
        el = el.parentElement;
      }
      return false;
    }
    function isProtectedChromeText(text) {
      const t = text || "";
      return /require\\(|missed the module|Recovery Mode|恢复模式|恢復模式|client-modules:|__ModuleLoader__|entrypoint|dsh-client-runtime/.test(t);
    }
    function scheduleDomWork(fn) {
      if (!domQueued) domQueued = [];
      domQueued.push(fn);
      if (domRaf) return;
      const run = () => {
        domRaf = 0;
        const jobs = domQueued;
        domQueued = null;
        if (!jobs) return;
        for (const job of jobs) job();
      };
      if (typeof requestAnimationFrame === "function") domRaf = requestAnimationFrame(run);
      else domRaf = window.setTimeout(run, 16);
    }
    function skipFilter(node) {
      if (node.nodeType === 1) {
        return node.matches && node.matches(DOM_SKIP_SELECTOR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
    function syncDocumentLocale(active) {
      const lang = LANGUAGES.find((item) => item.id === active);
      try {
        document.documentElement.lang = lang?.id ?? document.documentElement.lang;
      } catch { /* document may not be ready */ }
      if (mtRefresh) mtRefresh();
    }

    // ---- Traduzione automatica (LLM) ----
    // Con l'italiano attivo, il testo inglese lungo nel DOM passa dal modello.
    // Conversazione in streaming / composer esclusi (niente characterData), per non bloccare il renderer.
    let mtRefresh = null;

    function apply(ctx) {
      const locale = ctx.get("locale");
      if (!locale || typeof locale.register !== "function" || typeof locale.getLocale !== "function") {
        console.warn("[dsh-i18n] locale service unavailable; plugin degraded");
        return;
      }

      const isOurs = (id) => LANGUAGES.some((l) => l.id === id || localeKey(l.id) === localeKey(id));
      const findLang = (id) => LANGUAGES.find((l) => l.id === id || localeKey(l.id) === localeKey(id));

      // 0) Register languages into the official catalog (Harness 0.1.5+).
      //    setLocale only accepts catalog ids; snapshot patching alone is not enough.
      //    Missing keys fall back to en.
      const languageDisposers = [];
      if (typeof locale.addLanguage === "function") {
        for (const lang of LANGUAGES) {
          try {
            const dispose = locale.addLanguage({
              id: lang.id,
              label: lang.label,
              fallback: "en",
            });
            if (typeof dispose === "function") languageDisposers.push(dispose);
          } catch (error) {
            // Already registered (HMR / double apply) — keep going.
            if (!/already registered/i.test(String(error && error.message || error))) {
              console.error("[dsh-i18n] addLanguage", lang.id, error);
            }
          }
        }
        if (languageDisposers.length) {
          ctx.effect(() => () => { for (const d of languageDisposers) try { d(); } catch { /* ignore */ } }, "dsh-i18n: languages");
        }
      } else {
        // Legacy hosts without addLanguage: patch the snapshot option list.
        const snapshot = locale.getLocale();
        const locales = [...snapshot.locales];
        for (const lang of LANGUAGES) {
          if (!locales.some((l) => localeKey(l.id) === localeKey(lang.id))) {
            locales.push({ id: lang.id, label: lang.label });
          }
        }
        try {
          locale.snapshot = Object.freeze({
            active: snapshot.active,
            locales: Object.freeze(locales),
            revision: snapshot.revision,
          });
          locale.publish(snapshot.active, true);
        } catch (error) {
          console.error("[dsh-i18n] patch snapshot", error);
        }
      }

      // 1) Register curated dictionaries (single-locale form).
      for (const [langId, perNs] of Object.entries(DICTS)) {
        for (const [ns, dict] of Object.entries(perNs)) {
          try {
            ctx.effect(() => locale.register(ns, langId, dict), "dsh-i18n: " + langId + "/" + ns);
          } catch (error) {
            console.error("[dsh-i18n] register", langId, ns, error);
          }
        }
      }

      // 1.5) Wrap translate: curated first (case-insensitive dict keys), then English.
      const originalTranslate = locale.translate.bind(locale);
      locale.translate = (ns, key, params) => {
        const active = locale.getLocale().active;
        const lang = findLang(active);
        if (lang === undefined) return originalTranslate(ns, key, params);
        const dicts = locale.dicts;
        const curated =
          dictLookup(dicts, ns, active, key) ??
          (ns !== "common" ? dictLookup(dicts, "common", active, key) : undefined);
        if (curated !== undefined) return applyParams(curated, params);
        const fallback =
          dictLookup(dicts, ns, "en", key) ??
          (ns !== "common" ? dictLookup(dicts, "common", "en", key) : undefined);
        if (fallback !== undefined) return applyParams(fallback, params);
        return originalTranslate(ns, key, params);
      };

      // 2) Wrap setLocale: persist plugin preference + sync DOM/MT.
      //    With addLanguage, the original setLocale accepts our ids and writes Host settings.
      const originalSetLocale = locale.setLocale.bind(locale);
      locale.setLocale = (id) => {
        try {
          originalSetLocale(id);
        } catch (error) {
          // Legacy path: force-publish owned ids when catalog API is missing.
          if (isOurs(id) && typeof locale.publish === "function") {
            locale.publish(id, true);
          } else {
            throw error;
          }
        }
        writePref(isOurs(id) ? (findLang(id)?.id ?? id) : String(id));
        syncDocumentLocale(locale.getLocale().active);
      };

      // 3) Persist across Host adopt() resets (async settings load can clobber active).
      //    Empty storage + exact browser tag (it) seeds the choice once.
      //    A stored built-in id (zh / en) is an explicit choice and is left alone.
      const activateIfPreferred = () => {
        let pref = readPref();
        if (pref === null) {
          const browser = browserLocaleId();
          if (!browser) return;
          pref = browser;
          writePref(browser);
        }
        if (!isOurs(pref)) return;
        const want = findLang(pref)?.id ?? pref;
        if (locale.getLocale().active === want) {
          syncDocumentLocale(want);
          return;
        }
        try {
          originalSetLocale(want);
        } catch {
          try { locale.publish(want, true); } catch { /* ignore */ }
        }
        syncDocumentLocale(locale.getLocale().active);
      };
      if (typeof locale.adopt === "function") {
        const originalAdopt = locale.adopt.bind(locale);
        locale.adopt = (host) => {
          originalAdopt(host);
          activateIfPreferred();
          syncDocumentLocale(locale.getLocale().active);
        };
      }

      // 4) Auto-translate English long text via /api/dsh-i18n.translate.
      const connection = (() => { try { return ctx.get("connection"); } catch { return null; } })();
      if (connection && connection.rpc && typeof connection.rpc.call === "function") {
        const MT_CONFIG_KEY = "dsh-i18n.mt";
        const MT_BATCH = 12;
        const MT_CACHE_MAX = 1000;  // LRU: the Host keeps the persistent cache
        const MT_MAX_RETRIES = 2;
        const MT_RETRY_DELAY = 2000;
        const translateCache = new Map(); // English text -> translation
        const pendingTexts = new Set();   // queued, not yet sent
        const inFlight = new Set();       // sent, waiting for the Host
        const failures = new Map();       // text -> failed attempts
        const mtApplied = new WeakMap();  // Text node -> { original, translated } we wrote into it
        let mtTimer = null;
        let mtObserver = null;
        let mtWalkQueued = false;

        const cacheGet = (text) => {
          const value = translateCache.get(text);
          if (value !== undefined) { translateCache.delete(text); translateCache.set(text, value); }
          return value;
        };
        const cacheSet = (text, value) => {
          translateCache.delete(text);
          translateCache.set(text, value);
          while (translateCache.size > MT_CACHE_MAX) translateCache.delete(translateCache.keys().next().value);
        };
        const scheduleFlush = (delay) => {
          if (!mtTimer) mtTimer = window.setTimeout(flushMt, delay);
        };

        const mtActiveLang = () => locale.getLocale().active;
        const mtIsTarget = (id) => Boolean(findLang(id));
        const mtLooksTranslatable = (text) => {
          const t = (text || "").trim();
          if (t.length < 24 || t.length > 2000) return false;
          if (isProtectedChromeText(t)) return false;
          const words = t.split(/\\s+/).filter((w) => /[A-Za-z]/.test(w));
          if (words.length < 6) return false;
          let ascii = 0;
          for (const ch of t) if (ch.charCodeAt(0) < 128) ascii++;
          return ascii / t.length > 0.7;
        };
        const mtSkip = (node) => closestMatches(node, DOM_SKIP_SELECTOR);
        const mtHandleNode = (node) => {
          if (node.nodeType !== 3 || mtSkip(node)) return;
          const text = node.nodeValue;
          if (!text) return;
          // Already showing our translation: do not send the Italian text back to the model.
          const applied = mtApplied.get(node);
          if (applied !== undefined) {
            if (applied.translated === text) return;
            mtApplied.delete(node); // the app replaced the text; treat it as new content
          }
          if (!mtLooksTranslatable(text)) return;
          const cached = cacheGet(text);
          if (cached !== undefined) {
            mtApplied.set(node, { original: text, translated: cached });
            node.nodeValue = cached;
            return;
          }
          if (!pendingTexts.has(text) && !inFlight.has(text)) {
            pendingTexts.add(text);
            scheduleFlush(250);
          }
        };
        const mtWalk = (root) => {
          if (root.nodeType === 3) { mtHandleNode(root); return; }
          if (root.nodeType !== 1) return;
          if (root.matches && root.matches(DOM_SKIP_SELECTOR)) return;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: skipFilter });
          let n;
          while ((n = walker.nextNode())) mtHandleNode(n);
        };
        // Apply finished translations once per frame, however many batches arrive.
        const scheduleMtWalk = () => {
          if (mtWalkQueued) return;
          mtWalkQueued = true;
          scheduleDomWork(() => {
            mtWalkQueued = false;
            if (mtObserver) mtWalk(document.body);
          });
        };
        // Failed texts are retried a few times, then dropped until the page shows them again.
        const mtFailed = (texts) => {
          let retry = false;
          for (const t of texts) {
            const n = (failures.get(t) || 0) + 1;
            if (n > MT_MAX_RETRIES) { failures.delete(t); continue; }
            failures.set(t, n);
            if (mtObserver) { pendingTexts.add(t); retry = true; }
          }
          if (retry) scheduleFlush(MT_RETRY_DELAY);
        };
        function flushMt() {
          mtTimer = null;
          if (!pendingTexts.size) return;
          if (!mtIsTarget(mtActiveLang())) { pendingTexts.clear(); return; }
          const texts = [...pendingTexts].slice(0, MT_BATCH);
          for (const t of texts) { pendingTexts.delete(t); inFlight.add(t); }
          const targetLang = (findLang(mtActiveLang()) || {}).label;
          const cfg = (() => { try { return JSON.parse(window.localStorage.getItem(MT_CONFIG_KEY)) || {}; } catch { return {}; } })();
          const payload = { texts, targetLang };
          if (cfg.provider && cfg.model) {
            payload.provider = cfg.provider;
            payload.model = cfg.model;
            if (cfg.reasoningEffort) payload.reasoningEffort = cfg.reasoningEffort;
          }
          let call;
          try {
            call = Promise.resolve(connection.rpc.call("/api", "dsh-i18n.translate", payload));
          } catch (error) {
            call = Promise.reject(error);
          }
          call.then((result) => {
            for (const t of texts) inFlight.delete(t);
            const translations = result && result.ok && result.value && result.value.translations;
            if (!Array.isArray(translations)) {
              const msg = result && result.error && result.error.message ? result.error.message : "translate failed";
              console.warn("[dsh-i18n] auto-translate:", msg);
              mtFailed(texts);
              return;
            }
            texts.forEach((t, i) => {
              failures.delete(t);
              const tr = translations[i];
              if (typeof tr === "string" && tr && tr !== t) cacheSet(t, tr);
            });
            if (mtIsTarget(mtActiveLang())) scheduleMtWalk();
          }, (error) => {
            for (const t of texts) inFlight.delete(t);
            console.warn("[dsh-i18n] auto-translate rpc error:", error instanceof Error ? error.message : error);
            mtFailed(texts);
          });
          if (pendingTexts.size) scheduleFlush(250);
        }
        function startMt() {
          if (mtObserver) return;
          mtWalk(document.body);
          mtObserver = new MutationObserver((mutations) => {
            scheduleDomWork(() => {
              for (const m of mutations) {
                if (m.type === "characterData") continue;
                if (m.type === "childList") {
                  for (const added of m.addedNodes) {
                    if (added.nodeType === 3 && !mtSkip(added)) mtHandleNode(added);
                    else if (added.nodeType === 1 && !mtSkip(added)) mtWalk(added);
                  }
                }
              }
            });
          });
          mtObserver.observe(document.body, { childList: true, subtree: true, characterData: false });
        }
        // Put back the English text, so another language starts from the source
        // instead of from the Italian translation.
        function restoreMt(root) {
          if (root.nodeType !== 1) return;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: skipFilter });
          let n;
          while ((n = walker.nextNode())) {
            const applied = mtApplied.get(n);
            if (applied === undefined) continue;
            if (n.nodeValue === applied.translated) n.nodeValue = applied.original;
            mtApplied.delete(n);
          }
        }
        function stopMt() {
          const wasRunning = Boolean(mtObserver);
          if (mtObserver) { mtObserver.disconnect(); mtObserver = null; }
          if (mtTimer) { window.clearTimeout(mtTimer); mtTimer = null; }
          pendingTexts.clear();
          failures.clear();
          if (wasRunning) restoreMt(document.body);
        }
        mtRefresh = () => {
          if (mtIsTarget(mtActiveLang())) startMt();
          else stopMt();
        };
      } else {
        console.info("[dsh-i18n] connection.rpc unavailable; dictionary only (no LLM auto-translate)");
      }

      activateIfPreferred();
      syncDocumentLocale(locale.getLocale().active);
      try { window.setTimeout(() => syncDocumentLocale(locale.getLocale().active), 500); } catch { /* 忽略 */ }
      console.info("[dsh-i18n]", PLUGIN_VERSION, "ready; active=", locale.getLocale().active, "languages=", LANGUAGES.length);
    }

    module.exports = { name, inject, apply };
    return module.exports;
  },
});
`;

fs.mkdirSync(path.join(root, "lib"), { recursive: true });
fs.writeFileSync(outFile, clientJs, "utf8");
console.log("wrote", outFile, `(${clientJs.length} bytes)`);
