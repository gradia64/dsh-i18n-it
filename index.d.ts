/**
 * dsh-i18n-it — localizzazione italiana per la DSH Web UI.
 * Entry Host: registra la route /api/dsh-i18n.translate usata dalla traduzione automatica.
 */
export declare const name = "dsh-i18n";
export declare const inject: string[];

/** Opzioni del plugin lato host (vedi la tabella nel README). */
export interface Config {
  /** false: nessuna chiamata al modello, il testo resta in inglese. Default true. */
  autoTranslate: boolean;
  /** Effort per le traduzioni; "" lascia il default del modello. Default "off". */
  reasoningEffort: string;
  /** Cache su disco condivisa da tutti i browser. Default true. */
  cache: boolean;
  /** Percorso alternativo della cache; "" usa ~/.cache/dsh-i18n/translations.json. */
  cacheFile: string;
  /** Numero massimo di voci in cache. Default 5000. */
  cacheMaxEntries: number;
}

/** Schema delle opzioni: Config(input) completa i valori mancanti con i default. */
export declare const Config: (input?: Partial<Config>) => Config;

export declare function apply(ctx: unknown, config?: Partial<Config>): void;
