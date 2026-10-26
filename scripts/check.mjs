import fs from "node:fs";
import path from "node:path";
import { locales } from "./locales.mjs";

const root = path.join(import.meta.dirname, "..");
const baselineDir = path.join(root, "src", "en");
const files = fs.readdirSync(baselineDir).filter((name) => name.endsWith(".json")).sort();
const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const load = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fail = [];
const warn = [];

// --- 英文殘留閘 ---
// 值同 src/en 逐字節相同，唔一定係缺譯：純佔位符字串、專有名詞、技術識別碼本來就要照留。
// 判準：剝走佔位符同技術詞之後，仲剩 >= ENGLISH_WORD_THRESHOLD 個英文字 => 當缺譯。
// 單字／短標籤（例如波蘭文 "Model"）唔會中，整句英文散文一定中。
const ENGLISH_WORD_THRESHOLD = 3;
const LITERAL_TERMS = /\b(?:DeepSeek Harness|DSH|JSON|YAML|YML|npm|pnpm|MCP|API|URL|URI|CLI|GUI|SDK|LLM|TTFT|GPU|CPU|RAM|ZIP|PNG|JPG|JPEG|WebP|GIF|SVG|PDF|CSV|HTML|CSS|JS|TS|HTTP|HTTPS|SSH|OAuth|UUID|ID|IDs|Cordis|Electron|Node|TypeScript|JavaScript|Python|Markdown|Git|GitHub|GitLab|Docker|Linux|macOS|Windows|OK|tok\/s|str_replace_editor|Standard mode|PTC mode|Minimal mode|Creator mode|Code Mode SDK|Base URL)\b/g;
const englishWordCount = (value) => String(value)
  .replace(/\{[^{}]*\}/g, " ")        // 佔位符
  .replace(/\/[A-Za-z][\w-]*/g, " ")   // slash command，例如 /plan
  .replace(/[\w.-]+\.(?:ya?ml|json|mjs|cjs|js|ts|md|txt|log)\b/gi, " ") // 檔名
  .replace(LITERAL_TERMS, " ")
  .split(/[^A-Za-z']+/)
  .filter((word) => word.length >= 2).length;

// 注意：英文殘留閘只對「同 src/en 逐字節相同」嘅值生效。重寫過嘅英文散文（改咗
// 一兩個字）冇得可靠咁同其他拉丁系語言區分（法文/德文/西文詞一樣係拉丁字母），
// 所以唔強行偵測——呢個係已知限制，靠翻譯者自己唔好漏譯。

// --- Pending translations (DSH 0.2.0-rc.2 transition) ---
// Keys added by the 0.2.0-rc.2 re-extraction start as English placeholders.
// English residue stays a hard failure, except for the keys explicitly listed in
// scripts/pending-translation.json ("<locale>/<file>/<ns>.<key>"), which are
// reported as warnings. Translate a key, remove it from the list; once the list
// is empty, delete the file. Listed keys that are no longer untranslated fail,
// so the list cannot silently go stale.
//   node scripts/check.mjs --record-pending   # regenerate the list from the current state
const PENDING_FILE = path.join(root, "scripts", "pending-translation.json");
const PENDING = new Set(fs.existsSync(PENDING_FILE) ? load(PENDING_FILE) : []);
const RECORD = process.argv.includes("--record-pending");
const pendingSeen = new Set();
const newPending = [];

for (const locale of locales) {
  const dir = path.join(root, "src", locale.dir);
  if (!fs.existsSync(dir)) { fail.push(`${locale.id}: missing src/${locale.dir}`); continue; }
  const actualFiles = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  for (const file of files.filter((name) => !actualFiles.includes(name))) fail.push(`${locale.id}: missing file ${file}`);
  for (const file of actualFiles.filter((name) => !files.includes(name))) fail.push(`${locale.id}: stale file ${file}`);
  for (const file of files.filter((name) => actualFiles.includes(name))) {
    let base, translated;
    try { base = load(path.join(baselineDir, file)); translated = load(path.join(dir, file)); }
    catch (error) { fail.push(`${locale.id}/${file}: invalid JSON (${error.message})`); continue; }
    if (!Array.isArray(base.entries) || !Array.isArray(translated.entries)) { fail.push(`${locale.id}/${file}: invalid entries array`); continue; }
    if (translated.pkg !== base.pkg) fail.push(`${locale.id}/${file}: stale pkg metadata`);
    const baseNs = new Map(base.entries.map((entry) => [entry.ns, entry.dict]));
    // 上游本身就有空白值（分隔符／前綴，例如 cron.part.join = " "、zh sentenceSeparator = ""），
    // en 或 zh-src 任一邊係空白，譯文都可以係空白。
    const zhSrcFile = path.join(root, "src", "zh-src", file);
    const zhNs = new Map(fs.existsSync(zhSrcFile) ? load(zhSrcFile).entries.map((entry) => [entry.ns, entry.dict]) : []);
    const blankUpstream = (ns, key) => String(baseNs.get(ns)?.[key] ?? "x").trim() === "" || String(zhNs.get(ns)?.[key] ?? "x").trim() === "";
    const translatedNs = new Map(translated.entries.map((entry) => [entry.ns, entry.dict]));
    for (const ns of translatedNs.keys()) if (!baseNs.has(ns)) fail.push(`${locale.id}/${file}: stale namespace ${ns}`);
    for (const [ns, dict] of baseNs) {
      const target = translatedNs.get(ns);
      if (!target) { fail.push(`${locale.id}/${file}: missing namespace ${ns}`); continue; }
      for (const key of Object.keys(target)) if (!(key in dict)) fail.push(`${locale.id}/${file} [${ns}]: stale key ${key}`);
      for (const [key, value] of Object.entries(dict)) {
        if (!(key in target)) { fail.push(`${locale.id}/${file} [${ns}.${key}]: missing key`); continue; }
        if (typeof target[key] !== "string" || (target[key].trim() === "" && !blankUpstream(ns, key))) fail.push(`${locale.id}/${file} [${ns}.${key}]: empty value`);
        if (placeholders(target[key]).join("|") !== placeholders(value).join("|")) fail.push(`${locale.id}/${file} [${ns}.${key}]: placeholder mismatch`);
        if (target[key] === value && englishWordCount(value) >= ENGLISH_WORD_THRESHOLD) {
          const id = `${locale.id}/${file}/${ns}.${key}`;
          const msg = `${locale.id}/${file} [${ns}.${key}]: untranslated English (${englishWordCount(value)} words)`;
          if (RECORD) newPending.push(id);
          else if (PENDING.has(id)) { pendingSeen.add(id); warn.push(`${msg} (pending translation)`); }
          else fail.push(msg);
        }
      }
    }
  }
}

if (RECORD) {
  if (fail.length) {
    console.error(fail.map((message) => `✗ ${message}`).join("\n"));
    console.error(`i18n check failed: ${fail.length} issue(s); pending list not written`);
    process.exitCode = 1;
  } else {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(newPending.sort(), null, 2) + "\n");
    console.log(`recorded ${newPending.length} pending key(s) in ${path.relative(root, PENDING_FILE)}`);
  }
} else {
  for (const id of PENDING) {
    if (!pendingSeen.has(id)) fail.push(`${id}: listed in pending-translation.json but no longer untranslated; remove it from the list`);
  }
  // Warnings first, failures last, so failures stay visible at the end of the output.
  // No process.exit(): with piped output it can truncate pending writes.
  if (warn.length) {
    console.warn(warn.map((message) => `⚠ ${message}`).join("\n"));
    console.warn(`i18n check: ${warn.length} warning(s) — keys listed in scripts/pending-translation.json`);
  }
  if (fail.length) {
    console.error(fail.map((message) => `✗ ${message}`).join("\n"));
    console.error(`i18n check failed: ${fail.length} issue(s)`);
    process.exitCode = 1;
  } else {
    console.log(`i18n check passed: ${locales.length} locales × ${files.length} files` + (warn.length ? ` (${warn.length} pending translation)` : ""));
  }
}
