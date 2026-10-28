# dsh-i18n-it

Localizzazione italiana per la DeepSeek Harness Web UI. Aggiunge l'**Italiano** in **Impostazioni → Generali → Lingua**, accanto a 中文 / English, con tutte le stringhe dell'interfaccia tradotte a mano e la traduzione automatica del testo che il dizionario non copre.

Deriva da [gradia64/dsh-i18n](https://github.com/gradia64/dsh-i18n) (a sua volta fork di [mimateinn/dsh-i18n](https://github.com/mimateinn/dsh-i18n)), ridotto alla sola lingua italiana.

## Funzionalità

- Dizionario italiano per tutti i 54 pacchetti client di DSH (2910 chiavi, estratte da DSH 0.2.1-rc.3).
- Fallback in inglese: le stringhe nuove di DSH o dei plugin di terzi non ancora tradotte compaiono in inglese, mai come chiavi grezze.
- **Traduzione automatica**: con l'italiano attivo, il testo inglese lungo (descrizioni del marketplace, interfacce di terzi, messaggi di errore) viene tradotto dal modello configurato in DSH e salvato in cache. La conversazione in streaming e il composer non vengono toccati.
- La lingua scelta resta salvata in `localStorage` e sopravvive al ricaricamento.
- Nessuna modifica ai pacchetti di DSH; se il servizio locale manca, il plugin si disattiva in silenzio.

## Installazione

```bash
dsh plugin --profile <profilo-attivo> add github:gradia64/dsh-i18n-it
```

Se avevi installato il plugin multilingua, rimuovilo prima (la lingua scelta e la cache delle traduzioni restano):

```bash
dsh plugin --profile <profilo-attivo> remove @gradia64/dsh-i18n
```

Riavvia DSH e scegli **Italiano** in **Impostazioni → Generali → Lingua**. Per aggiornare, ripeti il comando `add`: pnpm fissa il commit risolto al momento dell'installazione.

Su DSH Desktop il profilo attivo è il valore `active` in `%APPDATA%/DSH Desktop/profile-selection/state.json` (di solito `desktop`). Passa sempre `--profile`: ogni shim `host-commands/<profilo>/bin/dsh.cmd` ha il proprio profilo scritto dentro, quindi lo shim `web` installa nel profilo `web` anche se Desktop usa `desktop`, e il plugin non viene mai caricato. Il Market di Desktop accetta solo versioni npm esatte, quindi un pacchetto da GitHub si installa solo dal terminale con `dsh plugin add`.

Rimozione: `dsh plugin --profile <profilo-attivo> remove @gradia64/dsh-i18n-it`.

## Configurazione (lato host)

| Opzione | Default | Effetto |
|---|---|---|
| `autoTranslate` | `true` | `false` disattiva le chiamate al modello; il testo non coperto resta in inglese. |
| `reasoningEffort` | `"off"` | Effort usato per le traduzioni; stringa vuota = default del modello. |
| `cache` | `true` | Cache su disco condivisa da tutti i browser (`~/.cache/dsh-i18n/translations.json`). |
| `cacheFile` | `""` | Percorso alternativo per la cache. |
| `cacheMaxEntries` | `5000` | Numero massimo di voci in cache. |

Dal browser si può forzare il modello di traduzione con `localStorage["dsh-i18n.mt"] = '{"provider":"…","model":"…"}'`.

## Compatibilità

- DeepSeek Harness da **0.1.1-rc.2** a **0.2.1-rc.3** inclusa (`engines.dsh`: `>=0.1.1-rc.2 <0.3.0-0`).
- Node.js `^22.19.0 || >=24.0.0`.
- Le `peerDependencies` hanno rami espliciti per `0.1.1-rc.*`, `0.2.0-rc.*` e `0.2.1-rc.*`, perché node-semver non esclude in silenzio le prerelease di DSH.

## Manutenzione

Quando esce una nuova versione di DSH:

```bash
node scripts/extract.mjs <percorso-dsh-installato>   # riestrae src/en e src/zh-src
node scripts/migrate-locales.mjs                     # aggiunge le chiavi nuove a src/it (segnaposto inglesi)
# tradurre in src/it/ le chiavi nuove
node scripts/check.mjs --record-pending              # aggiorna l'elenco delle chiavi intenzionalmente in inglese
npm test                                             # peer + controllo dizionario + build + test di runtime
```

- `scripts/extract.mjs` legge un elenco fisso di pacchetti (`PKGS`): un pacchetto client nuovo va aggiunto a mano. Lo script avvisa se trova pacchetti installati con dizionari che non sono nell'elenco.
- `scripts/check.mjs` fallisce su file, namespace o chiavi mancanti, segnaposto `{…}` diversi dall'inglese e frasi inglesi di 3+ parole non tradotte (salvo quelle in `scripts/pending-translation.json`).
- `lib/client.js` è generato da `scripts/assemble.mjs`: non modificarlo a mano.

## Sicurezza e privacy

- Il plugin non fa chiamate di rete per conto suo, non ha telemetria e usa solo due chiavi di `localStorage`: la lingua scelta e l'eventuale modello di traduzione.
- La traduzione automatica passa dal servizio LLM interno di DSH (il tuo modello), non da API esterne, e parte solo con l'italiano attivo.
- L'unico accesso al filesystem è la cache delle traduzioni lato host.

## Licenza

MIT
