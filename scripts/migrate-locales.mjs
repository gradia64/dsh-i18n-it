// migrate-locales.mjs — Merge new upstream keys from src/en/ into each locale directory.
//
// For each locale directory (src/<locale>/), for each package in src/en/:
//   - If the locale file already exists: keep existing translations for existing keys,
//     add new keys from src/en/ as English (pending translation), remove stale keys.
//   - If the locale file doesn't exist: copy from src/en/ (English baseline).
//
// New packages (in src/en/ but not in any locale) are created from src/en/ for all locales.
//
// This script preserves existing curated translations and only adds English
// placeholders for new keys that haven't been translated yet.
import fs from "node:fs";
import path from "node:path";
import { locales } from "./locales.mjs";

const root = path.join(import.meta.dirname, "..");
const enDir = path.join(root, "src", "en");

const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith(".json")).sort();

let addedFiles = 0;
let mergedFiles = 0;
let addedKeys = 0;
let staleKeys = 0;

for (const locale of locales) {
  const localeDir = path.join(root, "src", locale.dir);
  if (!fs.existsSync(localeDir)) {
    console.error(`SKIP: src/${locale.dir} does not exist`);
    continue;
  }

  const existingFiles = new Set(fs.readdirSync(localeDir).filter((f) => f.endsWith(".json")));

  for (const file of enFiles) {
    const enData = JSON.parse(fs.readFileSync(path.join(enDir, file), "utf8"));
    const localeFile = path.join(localeDir, file);

    if (!existingFiles.has(file)) {
      // New package file — copy from English baseline
      fs.copyFileSync(path.join(enDir, file), localeFile);
      addedFiles++;
      continue;
    }

    // Existing package file — merge
    const localeData = JSON.parse(fs.readFileSync(localeFile, "utf8"));
    const enNsMap = new Map(enData.entries.map((e) => [e.ns, e.dict]));
    const localeNsMap = new Map(localeData.entries.map((e) => [e.ns, e.dict]));

    const mergedEntries = [];

    for (const enEntry of enData.entries) {
      const ns = enEntry.ns;
      const localeDict = localeNsMap.get(ns);

      if (!localeDict) {
        // Namespace is new in this package — use English values
        mergedEntries.push({ ns, dict: { ...enEntry.dict } });
        continue;
      }

      const mergedDict = {};
      // Keep existing translations for existing keys, add new keys from en
      for (const [key, enValue] of Object.entries(enEntry.dict)) {
        if (key in localeDict) {
          mergedDict[key] = localeDict[key];
        } else {
          // New key — use English as placeholder (pending translation)
          mergedDict[key] = enValue;
          addedKeys++;
        }
      }
      // Remove stale keys (in locale but not in en)
      for (const key of Object.keys(localeDict)) {
        if (!(key in enEntry.dict)) {
          staleKeys++;
        }
      }

      mergedEntries.push({ ns, dict: mergedDict });
    }

    // Handle stale namespaces in locale (shouldn't happen normally)
    for (const localeEntry of localeData.entries) {
      if (!enNsMap.has(localeEntry.ns)) {
        staleKeys++;
      }
    }

    const mergedData = { pkg: enData.pkg, entries: mergedEntries };
    fs.writeFileSync(localeFile, JSON.stringify(mergedData, null, 2), "utf8");
    mergedFiles++;
  }
}

console.log(`Migration complete:`);
console.log(`  Added ${addedFiles} new package files`);
console.log(`  Merged ${mergedFiles} existing package files`);
console.log(`  Added ${addedKeys} new keys (English placeholders, pending translation)`);
console.log("Next steps:");
console.log("  node scripts/check.mjs --record-pending  # list the remaining English placeholders");
console.log(`  Removed ${staleKeys} stale keys`);
