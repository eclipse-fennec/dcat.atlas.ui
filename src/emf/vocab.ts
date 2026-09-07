/**
 * Beschriftungen für die IRI-wertigen Felder des DCAT-AP-Modells.
 *
 * Im Modell des Servers sind `theme`, `format`, `language`,
 * `accrualPeriodicity`, `accessRights` und Verwandte reine IRIs
 * (`XMLType#//AnyURI`) — nicht mehr eingebettete SKOS-Concepts mit
 * `prefLabel`. Der Viewer löst sie deshalb selbst auf: bekannte Codes der
 * EU-Authority-Tabellen bekommen einen deutschen Namen, alles andere fällt
 * auf das letzte URI-Segment zurück.
 */

/** EU-Authority `data-theme` — die 13 Kategorien von data.europa.eu. */
const DATA_THEMES: Record<string, string> = {
  AGRI: 'Landwirtschaft & Ernährung',
  ECON: 'Wirtschaft & Finanzen',
  EDUC: 'Bildung, Kultur & Sport',
  ENER: 'Energie',
  ENVI: 'Umwelt',
  GOVE: 'Regierung & öffentlicher Sektor',
  HEAL: 'Gesundheit',
  INTR: 'Internationale Themen',
  JUST: 'Justiz & öffentliche Sicherheit',
  REGI: 'Regionen & Städte',
  SOCI: 'Bevölkerung & Gesellschaft',
  TECH: 'Wissenschaft & Technologie',
  TRAN: 'Verkehr',
};

/** EU-Authority `frequency` — die im offenen Datenumfeld gebräuchlichen Codes. */
const FREQUENCIES: Record<string, string> = {
  CONT: 'kontinuierlich',
  UPDATE_CONT: 'laufend aktualisiert',
  HOURLY: 'stündlich',
  DAILY: 'täglich',
  WEEKLY: 'wöchentlich',
  BIWEEKLY: 'zweiwöchentlich',
  MONTHLY: 'monatlich',
  BIMONTHLY: 'zweimonatlich',
  QUARTERLY: 'vierteljährlich',
  ANNUAL: 'jährlich',
  ANNUAL_2: 'halbjährlich',
  BIENNIAL: 'zweijährlich',
  TRIENNIAL: 'dreijährlich',
  IRREG: 'unregelmäßig',
  NEVER: 'keine Aktualisierung',
  UNKNOWN: 'unbekannt',
  OTHER: 'sonstige',
};

/** EU-Authority `language`, ISO 639-3. */
const LANGUAGES: Record<string, string> = {
  DEU: 'Deutsch',
  ENG: 'Englisch',
  FRA: 'Französisch',
  SPA: 'Spanisch',
  ITA: 'Italienisch',
  NLD: 'Niederländisch',
  POL: 'Polnisch',
  CES: 'Tschechisch',
  DAN: 'Dänisch',
  MUL: 'mehrsprachig',
};

/** Letztes Segment einer IRI, ohne Fragment, prozentdekodiert. */
export function iriSegment(iri: string | undefined | null): string {
  if (!iri) return '';
  const clean = String(iri).split('#')[0].replace(/\/+$/, '');
  const last = clean.substring(clean.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Generische Beschriftung: bekannter Code, sonst lesbar gemachtes Segment. */
export function iriLabel(iri: string | undefined | null): string {
  const seg = iriSegment(iri);
  if (!seg) return '';
  return seg.replace(/[_-]+/g, ' ');
}

export function themeLabel(iri: string | undefined | null): string {
  const seg = iriSegment(iri);
  return DATA_THEMES[seg.toUpperCase()] ?? iriLabel(iri);
}

export function frequencyLabel(iri: string | undefined | null): string {
  const seg = iriSegment(iri);
  return FREQUENCIES[seg.toUpperCase()] ?? iriLabel(iri);
}

export function languageLabel(iri: string | undefined | null): string {
  const seg = iriSegment(iri);
  return LANGUAGES[seg.toUpperCase()] ?? iriLabel(iri);
}

/**
 * Lizenz-IRI ohne eigenen Titel.
 *
 * Die Kennung steht bei den gängigen Lizenzen im vorletzten Segment, das
 * letzte trägt die Version (`…/licenses/dl-by-de/2.0`) — nur „2.0“ zu zeigen
 * benennt nichts. Bekannte Kennungen bekommen ihren ausgeschriebenen Namen.
 */
const LICENSES: Record<string, string> = {
  'dl-by-de': 'Datenlizenz Deutschland – Namensnennung',
  'dl-zero-bdm': 'Datenlizenz Deutschland – Zero',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  'cc-zero': 'CC0',
  'cc-by-nc': 'CC BY-NC',
  'odbl': 'ODbL',
  'other-closed': 'geschlossene Lizenz',
  'other-open': 'offene Lizenz',
};

export function licenseLabel(iri: string | undefined | null): string {
  if (!iri) return '';
  const clean = String(iri).split('#')[0].replace(/\/+$/, '');
  const segments = clean.split('/');
  const last = segments[segments.length - 1] ?? '';
  const isVersion = /^v?\d+(\.\d+)*$/.test(last);
  const id = isVersion ? segments[segments.length - 2] ?? last : last;
  const name = LICENSES[id.toLowerCase()];
  if (name) return isVersion ? `${name} ${last}` : name;
  return isVersion ? `${id} ${last}` : iriLabel(iri);
}

/**
 * Format-Badge. Die EU-Authority `file-type` liefert schon `CSV`, `JSON`,
 * `GEOJSON` …; ein Medientyp wie `text/csv` wird auf seinen Subtyp gekürzt.
 */
export function formatLabel(value: string | undefined | null): string {
  if (!value) return '';
  const raw = String(value);
  if (raw.includes('/') && !raw.includes('://')) {
    // Medientyp: text/csv -> CSV, application/geo+json -> GEO+JSON
    return raw.substring(raw.indexOf('/') + 1).replace(/^vnd\..*?\./, '').toUpperCase();
  }
  return iriSegment(raw).toUpperCase();
}

// ---------------------------------------------------------------- Auswahllisten
//
// Dieselben Tabellen, nur andersherum gelesen: die Anzeige übersetzt IRI ->
// Text, ein Formular braucht Text -> IRI. Beides aus einer Quelle, damit ein
// angelegter Wert später auch wieder benannt werden kann.

export interface VocabOption {
  iri: string;
  label: string;
}

const EU_AUTHORITY = 'http://publications.europa.eu/resource/authority';

function optionsFrom(base: string, table: Record<string, string>): VocabOption[] {
  return Object.entries(table)
    .map(([code, label]) => ({ iri: `${base}/${code}`, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/** Die 13 Kategorien der EU-Authority `data-theme`. */
export const THEME_OPTIONS: VocabOption[] = optionsFrom(`${EU_AUTHORITY}/data-theme`, DATA_THEMES);

/** Aktualisierungsfrequenzen der EU-Authority `frequency`. */
export const FREQUENCY_OPTIONS: VocabOption[] = optionsFrom(`${EU_AUTHORITY}/frequency`, FREQUENCIES);

/** Sprachen der EU-Authority `language`, ISO 639-3. */
export const LANGUAGE_OPTIONS: VocabOption[] = optionsFrom(`${EU_AUTHORITY}/language`, LANGUAGES);

/**
 * Lizenzen aus der DCAT-AP.de-Liste. Anders als die drei oben sind die IRIs
 * hier nicht nach einem Schema aus dem Code gebildet — sie tragen eine
 * Versionsangabe, die je Lizenz anders aussieht.
 */
export const LICENSE_OPTIONS: VocabOption[] = [
  { iri: 'http://dcat-ap.de/def/licenses/dl-by-de/2.0', label: 'Datenlizenz Deutschland – Namensnennung 2.0' },
  { iri: 'http://dcat-ap.de/def/licenses/dl-zero-bdm/2.0', label: 'Datenlizenz Deutschland – Zero 2.0' },
  { iri: 'http://dcat-ap.de/def/licenses/cc-by/4.0', label: 'CC BY 4.0' },
  { iri: 'http://dcat-ap.de/def/licenses/cc-by-sa/4.0', label: 'CC BY-SA 4.0' },
  { iri: 'http://dcat-ap.de/def/licenses/cc-zero', label: 'CC0' },
  { iri: 'http://dcat-ap.de/def/licenses/odbl', label: 'ODbL' },
  { iri: 'http://dcat-ap.de/def/licenses/other-open', label: 'Andere offene Lizenz' },
  { iri: 'http://dcat-ap.de/def/licenses/other-closed', label: 'Andere geschlossene Lizenz' },
];

/**
 * Dateiformate der EU-Authority `file-type`, die im offenen Datenumfeld
 * tatsächlich vorkommen — die vollständige Tabelle hat über hundert Einträge
 * und wäre in einem Auswahlfeld unbrauchbar.
 *
 * Der Medientyp steht daneben, damit ein Formular ihn vorbelegen kann: beide
 * Felder beschreiben dasselbe, nur in verschiedenen Registern, und sie
 * getrennt eintippen zu lassen lädt zu Widersprüchen ein.
 */
export const FILE_TYPE_OPTIONS: Array<VocabOption & { mediaType: string }> = [
  { iri: `${EU_AUTHORITY}/file-type/CSV`,      label: 'CSV',      mediaType: 'text/csv' },
  { iri: `${EU_AUTHORITY}/file-type/JSON`,     label: 'JSON',     mediaType: 'application/json' },
  { iri: `${EU_AUTHORITY}/file-type/GEOJSON`,  label: 'GeoJSON',  mediaType: 'application/geo+json' },
  { iri: `${EU_AUTHORITY}/file-type/XML`,      label: 'XML',      mediaType: 'application/xml' },
  { iri: `${EU_AUTHORITY}/file-type/XLSX`,     label: 'Excel (XLSX)', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { iri: `${EU_AUTHORITY}/file-type/ODS`,      label: 'OpenDocument (ODS)', mediaType: 'application/vnd.oasis.opendocument.spreadsheet' },
  { iri: `${EU_AUTHORITY}/file-type/PDF`,      label: 'PDF',      mediaType: 'application/pdf' },
  { iri: `${EU_AUTHORITY}/file-type/HTML`,     label: 'HTML',     mediaType: 'text/html' },
  { iri: `${EU_AUTHORITY}/file-type/TXT`,      label: 'Text',     mediaType: 'text/plain' },
  { iri: `${EU_AUTHORITY}/file-type/ZIP`,      label: 'ZIP',      mediaType: 'application/zip' },
  { iri: `${EU_AUTHORITY}/file-type/GML`,      label: 'GML',      mediaType: 'application/gml+xml' },
  { iri: `${EU_AUTHORITY}/file-type/SHP`,      label: 'Shapefile', mediaType: 'application/vnd.shp' },
  { iri: `${EU_AUTHORITY}/file-type/RDF_XML`,  label: 'RDF/XML',  mediaType: 'application/rdf+xml' },
  { iri: `${EU_AUTHORITY}/file-type/RDF_TURTLE`, label: 'Turtle', mediaType: 'text/turtle' },
  { iri: `${EU_AUTHORITY}/file-type/JSON_LD`,  label: 'JSON-LD',  mediaType: 'application/ld+json' },
  { iri: `${EU_AUTHORITY}/file-type/PARQUET`,  label: 'Parquet',  mediaType: 'application/vnd.apache.parquet' },
];
