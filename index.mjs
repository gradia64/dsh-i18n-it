// index.mjs — dsh-i18n 插件（Host 側）
//
// 提供 /api/dsh-i18n.translate Fetch 路由（Harness 0.1.5+）：
// translate({texts, targetLang, provider?, model?, reasoningEffort?}) → { translations }。
// 用 ctx.llm.stream 做單次批量翻譯，供 client 側「自動翻譯」使用。
// 預設用 agentDefaultModel（用戶主要模型），client 可傳 provider/model 覆寫。

import { createRequire } from "node:module";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Schema from "@deepseek-ai/schemastery";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

const name = "dsh-i18n";
const inject = ["llm"];
const API_METHOD = "dsh-i18n.translate";

// Limiti del payload di translate. Il client invia lotti di 12 testi da 24–2000
// caratteri; l'endpoint però è raggiungibile da qualunque client o plugin, quindi
// rifiuta richieste più grandi invece di passarle al modello e alla cache.
const MAX_TEXTS = 48;
const MAX_TEXT_LENGTH = 4000;
const MAX_TARGET_LANG_LENGTH = 64;

/** Restituisce il motivo del rifiuto, o null se il payload è valido. */
function invalidTranslatePayload(payload) {
  const { texts, targetLang } = payload || {};
  if (!Array.isArray(texts) || texts.length === 0) return "texts must be a non-empty array";
  if (texts.length > MAX_TEXTS) return `too many texts (max ${MAX_TEXTS})`;
  if (!texts.every((t) => typeof t === "string" && t.length > 0 && t.length <= MAX_TEXT_LENGTH)) {
    return `texts must be non-empty strings of at most ${MAX_TEXT_LENGTH} characters`;
  }
  if (typeof targetLang !== "string" || targetLang.length === 0 || targetLang.length > MAX_TARGET_LANG_LENGTH) {
    return `targetLang must be a non-empty string of at most ${MAX_TARGET_LANG_LENGTH} characters`;
  }
  return null;
}

// --- gradia-local: config, reasoning off di default, cache persistente -----
//
// autoTranslate: false  → nessuna chiamata al modello; il testo resta in inglese.
// reasoningEffort       → effort usato per le traduzioni (default "off": niente
//                         thinking). Stringa vuota = lascia il default del modello.
// cache                 → cache su disco condivisa da tutti i browser, così una
//                         stringa già tradotta non torna mai al modello.
const Config = Schema.object({
  autoTranslate: Schema.boolean().default(true),
  reasoningEffort: Schema.string().default("off"),
  cache: Schema.boolean().default(true),
  cacheFile: Schema.string().default(""),
  cacheMaxEntries: Schema.number().default(5000),
});

function defaultCacheFile() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "dsh-i18n", "translations.json");
}

/**
 * Cache persistente (lingua + testo → traduzione). Le voci più vecchie escono
 * per prime oltre cacheMaxEntries; il salvataggio è differito e atomico.
 */
function createTranslationCache(file, maxEntries, logger) {
  const map = new Map();
  let loaded = null;
  let saveTimer = null;
  const key = (lang, text) => lang + "\u0000" + text;
  const load = () => (loaded ??= readFile(file, "utf8").then((raw) => {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) for (const [k, v] of data) if (typeof k === "string" && typeof v === "string") map.set(k, v);
  }).catch((error) => {
    if (error?.code !== "ENOENT") logger?.("cache illeggibile, riparto da zero: " + (error?.message ?? error));
  }));
  const save = async () => {
    saveTimer = null;
    try {
      await mkdir(dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      await writeFile(tmp, JSON.stringify([...map]), "utf8");
      await rename(tmp, file);
    } catch (error) {
      logger?.("salvataggio cache fallito: " + (error?.message ?? error));
    }
  };
  return {
    load,
    get: (lang, text) => map.get(key(lang, text)),
    set(lang, text, translation) {
      const k = key(lang, text);
      map.delete(k);
      map.set(k, translation);
      while (map.size > maxEntries) map.delete(map.keys().next().value);
      if (!saveTimer) saveTimer = setTimeout(save, 2000);
    },
    flush: () => (saveTimer ? (clearTimeout(saveTimer), save()) : Promise.resolve()),
    get size() { return map.size; },
  };
}

/** Traduce solo i testi non in cache e ricompone il risultato nell'ordine originale. */
async function translateWithCache(cache, texts, targetLang, translateMissing) {
  if (cache) await cache.load();
  const result = texts.map((t) => (cache ? cache.get(targetLang, t) : undefined));
  const missing = [...new Set(texts.filter((_, i) => result[i] === undefined))];
  if (missing.length > 0) {
    const translated = await translateMissing(missing);
    if (translated.length !== missing.length) throw new Error("translation length mismatch");
    const byText = new Map(missing.map((t, i) => [t, translated[i]]));
    for (let i = 0; i < texts.length; i++) {
      if (result[i] === undefined) result[i] = byText.get(texts[i]);
    }
    if (cache) for (const [t, tr] of byText) if (tr && tr !== t) cache.set(targetLang, t, tr);
  }
  return result;
}
// --- fine gradia-local -------------------------------------------------------

const ok = (value) => ({ ok: true, value });
const failure = (error) => ({
  ok: false,
  error: { code: "internal", message: error instanceof Error ? error.message : String(error), details: {} },
});

function parseTranslations(text, expected) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : parsed.translations;
    if (!Array.isArray(arr)) throw new Error("not an array");
    return arr.slice(0, expected).map((s) => String(s));
  } catch (error) {
    throw new Error("cannot parse translation output: " + (error instanceof Error ? error.message : String(error)));
  }
}

async function translate(ctx, texts, targetLang, route, signal) {
  const messages = [
    createUserMessage({
      content: [{ type: "text", text: JSON.stringify({ texts, targetLang }) }],
      source: { kind: "plugin", plugin: "dsh-i18n" },
    }),
  ];
  const assembler = new BlockAssembler();
  const options = {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
    messages,
    system:
      "You are a professional translator. Translate each string in the JSON input array to " +
      targetLang +
      ". Return ONLY a JSON array of strings, same length and order as input. No commentary, no markdown fences.",
    purpose: "dsh-i18n-translate",
    ...(signal ? { signal } : {}),
  };
  for await (const chunk of ctx.llm.stream(options)) {
    assembler.push(chunk);
  }
  if (assembler.finish && assembler.finish.kind !== "stop") {
    throw new Error("llm finish: " + assembler.finish.kind);
  }
  const text = assembler.blocks().filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseTranslations(text, texts.length);
}

function readEnvelope(body) {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body;
  if (record.type !== "client-request" || typeof record.rpcId !== "string" || typeof record.method !== "string") {
    return undefined;
  }
  return { rpcId: record.rpcId, method: record.method, payload: record.payload };
}

function serverResponse(rpcId, result) {
  return Response.json({ type: "server-response", rpcId, result });
}

function resolveModelRoute(ctx, payload) {
  if (payload?.provider && payload?.model) {
    return { provider: payload.provider, model: payload.model, reasoningEffort: payload.reasoningEffort };
  }
  const tryRead = (getter) => {
    try {
      return getter()?.currentSelection?.() ?? null;
    } catch {
      return null;
    }
  };
  return (
    tryRead(() => ctx.get("agentDefaultModel")) ??
    tryRead(() => ctx.agentDefaultModel) ??
    null
  );
}

function apply(ctx, config = Config({})) {
  const warn = (msg) => { try { ctx.logger?.("dsh-i18n")?.warn?.(msg); } catch { /* ignore */ } };
  const cache = config.cache
    ? createTranslationCache(config.cacheFile || defaultCacheFile(), config.cacheMaxEntries, warn)
    : null;
  if (cache) ctx.on("dispose", () => cache.flush());
  // Harness 0.1.5-rc.2: connection.rpc.handle uses the connection fiber's
  // webServer, which that plugin no longer injects. Mount an exact /api
  // Fetch route instead (same pattern as dsh-plugin-subscriptions).
  ctx.inject(["connection"], (connectionCtx) => {
    const connection = connectionCtx.get("connection");
    const handler = async (endpoint, payload, signal) => {
      try {
        if (endpoint !== "translate") return failure(new Error("unknown endpoint " + endpoint));
        const invalid = invalidTranslatePayload(payload);
        if (invalid) return failure(new Error("invalid translate payload: " + invalid));
        const { texts, targetLang } = payload;
        // Auto-traduzione spenta: rispondi con il testo originale, zero chiamate al modello.
        if (!config.autoTranslate) return ok({ translations: [...texts] });
        const route = resolveModelRoute(ctx, payload);
        if (!route || !route.provider || !route.model) {
          try { connectionCtx.logger?.warn?.("[dsh-i18n] no model route for auto-translate"); } catch { /* ignore */ }
          return failure(new Error("no model route"));
        }
        // L'effort scelto esplicitamente dal client vince; altrimenti quello della config.
        // Copia: la selezione di default dell'agente non va mai modificata.
        const callRoute = { provider: route.provider, model: route.model };
        const effort = payload?.reasoningEffort || config.reasoningEffort || route.reasoningEffort;
        if (effort) callRoute.reasoningEffort = effort;
        const translations = await translateWithCache(cache, texts, targetLang,
          (missing) => translate(ctx, missing, targetLang, callRoute, signal));
        if (translations.length !== texts.length) return failure(new Error("translation length mismatch"));
        return ok({ translations });
      } catch (error) {
        try {
          connectionCtx.logger?.warn?.("[dsh-i18n] translate error: " + (error instanceof Error ? error.message : String(error)));
        } catch { /* ignore */ }
        return failure(error);
      }
    };
    connectionCtx.effect(() => connection.fetch.register({
      path: `/api/${API_METHOD}`,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
          return new Response("content type must be application/json", { status: 415 });
        }
        let body;
        try {
          body = await request.json();
        } catch {
          return new Response("body is not JSON", { status: 400 });
        }
        const envelope = readEnvelope(body);
        if (envelope === undefined) {
          const rawId = body?.rpcId;
          return serverResponse(typeof rawId === "string" ? rawId : "invalid-request", {
            ok: false,
            error: { code: "gateway/bad-request", message: "invalid client-request message", details: { issues: [] } },
          });
        }
        if (envelope.method !== API_METHOD) {
          return serverResponse(envelope.rpcId, {
            ok: false,
            error: {
              code: "gateway/bad-request",
              message: `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(API_METHOD)}`,
              details: { issues: [] },
            },
          });
        }
        return serverResponse(envelope.rpcId, await handler("translate", envelope.payload, request.signal));
      },
    }), "dsh-i18n: /api/dsh-i18n.translate route");
    try { connectionCtx.logger?.info?.(`[dsh-i18n] ${version} mounted /api/dsh-i18n.translate`); } catch { /* ignore */ }
  });
}

export { apply, Config, inject, name, createTranslationCache, invalidTranslatePayload, translateWithCache };
