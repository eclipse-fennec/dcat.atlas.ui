/**
 * Kleine EMF-Reflection-Helfer für die DCAT-AP-Darstellung.
 *
 * Zugeschnitten auf das Modell, das DCAT.Atlas ausliefert: mehrsprachige Texte
 * sind `rdf:PlainLiteral` (`value` + `lang`), Datumsangaben sind
 * `rdf:DateOrDateTimeLiteral` (`value`), und alles Kontrollierte
 * (`theme`, `format`, `language`, …) ist ein blanker IRI-String.
 */
import type { EObject } from '@emfts/core';

/** Bevorzugte Sprachen für mehrsprachige Literale, in dieser Reihenfolge. */
export const PREFERRED_LANGS = ['de', 'en'];

/**
 * Liest ein Feature per Name aus einem EObject.
 *
 * Fehlertolerant: Referenzen über Dokumentgrenzen hinweg (Katalog → Dataset,
 * Distribution → DataService) stehen als Proxy im Modell, und deren Auflösung
 * kann nicht gelingen — die Zieldokumente liegen hinter HTTP und werden von
 * der API-Schicht separat geholt.
 */
export function eget(obj: EObject | undefined | null, name: string): any {
  if (!obj) return undefined;
  try {
    const f = obj.eClass?.()?.getEStructuralFeature?.(name);
    return f ? obj.eGet(f) : undefined;
  } catch {
    return undefined;
  }
}

/** Wandelt einen Wert in ein Array um (EList, Einzelwert oder nichts). */
export function asList(v: any): any[] {
  if (v == null) return [];
  if (typeof v === 'string') return [v];
  if (isIterable(v)) return Array.from(v as Iterable<any>);
  return [v];
}

/**
 * Navigiert durch XSD-Wrapper-Objekte zum inneren Objekt.
 *
 * Das Modell des Servers ist flach, hier bleibt die Funktion nur als
 * Rückfallebene für Wrapper-Typen, die einzelne Ecores noch kennen.
 */
export function unwrap(obj: any): any {
  if (!obj || typeof obj !== 'object' || !obj.eClass) return obj;
  const ec = obj.eClass();
  if (!ec) return obj;
  // Ein Objekt mit eigenem Textwert ist kein Wrapper.
  if (typeof eget(obj, 'value') === 'string') return obj;
  for (const f of ec.getEAllStructuralFeatures()) {
    if (!('isContainment' in f) || typeof f.isContainment !== 'function' || !f.isContainment()) continue;
    const inner = obj.eGet(f);
    if (inner && typeof inner === 'object' && inner.eClass) return inner;
  }
  return obj;
}

/** Extrahiert einen lesbaren String aus einem Wert (PlainLiteral, Agent, IRI, …). */
function resolveValue(obj: any): string {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  const unwrapped = unwrap(obj);
  for (const feat of ['value', 'name', 'fn', 'organizationName', 'title', 'prefLabel', 'about']) {
    const v = eget(unwrapped, feat);
    if (typeof v === 'string' && v) return v;
    if (v && isIterable(v)) {
      const first = Array.from(v as Iterable<any>)[0];
      if (first) {
        const s = typeof first === 'string' ? first : eget(first, 'value');
        if (typeof s === 'string' && s) return s;
      }
    }
  }
  return '';
}

/** `lang` eines PlainLiteral, klein geschrieben und ohne Region. */
function langOf(literal: any): string {
  const lang = eget(literal, 'lang');
  return typeof lang === 'string' ? lang.toLowerCase().split('-')[0] : '';
}

/**
 * Der erste lesbare Wert eines Features.
 *
 * Bei mehrsprachigen Literalen gewinnt die erste Sprache aus
 * {@link PREFERRED_LANGS}, die vorkommt — sonst der erste Eintrag.
 */
export function getLabel(obj: EObject | undefined | null, featureName: string): string {
  const val = eget(obj, featureName);
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);

  if (!isIterable(val)) return resolveValue(val);

  const list = Array.from(val as Iterable<any>);
  if (list.length === 0) return '';
  for (const lang of PREFERRED_LANGS) {
    const hit = list.find((entry) => langOf(entry) === lang);
    if (hit) {
      const text = resolveValue(hit);
      if (text) return text;
    }
  }
  return resolveValue(list.find((entry) => resolveValue(entry)) ?? list[0]);
}

/** Alle Werte eines Features als Strings (z. B. alle Keywords, alle Themen-IRIs). */
export function getAllLabels(obj: EObject | undefined | null, featureName: string): string[] {
  const val = eget(obj, featureName);
  if (val == null) return [];
  if (typeof val === 'string') return [val];
  if (isIterable(val)) {
    return Array.from(val as Iterable<any>).map(resolveValue).filter(Boolean);
  }
  const resolved = resolveValue(val);
  return resolved ? [resolved] : [];
}

/**
 * Wie {@link getAllLabels}, aber ohne Doppelte und nur eine Fassung je
 * mehrsprachigem Text — für Schlagwörter, die pro Sprache einmal vorkommen.
 */
export function getPreferredLabels(obj: EObject | undefined | null, featureName: string): string[] {
  const val = eget(obj, featureName);
  if (val == null) return [];
  if (!isIterable(val)) return getAllLabels(obj, featureName);

  const list = Array.from(val as Iterable<any>);
  const langs = new Set(list.map(langOf).filter(Boolean));
  const chosen = PREFERRED_LANGS.find((l) => langs.has(l));
  const filtered = chosen ? list.filter((e) => langOf(e) === chosen) : list;
  return Array.from(new Set(filtered.map(resolveValue).filter(Boolean)));
}

function isIterable(val: any): boolean {
  return val != null && typeof val === 'object' && Symbol.iterator in val;
}

/**
 * Die Ziel-URIs einer Referenzliste, die über Dokumentgrenzen zeigt.
 *
 * Member wie `<dataset href="…/datasets/x#/"/>` bleiben Proxies: das
 * Zieldokument liegt hinter HTTP und wird nicht synchron nachgeladen. Die
 * Adresse steht aber im Proxy, und mehr braucht es zum Filtern nicht — die
 * Datensätze selbst kommen ohnehin aus `GET /datasets`.
 *
 * Ein bereits aufgelöstes Objekt (etwa eingebettet statt referenziert) wird
 * über sein `about` erfasst, damit beide Formen dasselbe liefern.
 */
export function referenceUris(obj: EObject | undefined | null, featureName: string): string[] {
  return asList(eget(obj, featureName))
    .map((ref: any) => {
      if (typeof ref === 'string') return ref;
      if (!ref || typeof ref !== 'object') return '';
      const proxy = typeof ref.eProxyURI === 'function' ? ref.eProxyURI() : null;
      return proxy ? String(proxy) : getAbout(ref);
    })
    .filter(Boolean);
}

/** Der `about`-IRI einer `rdf:IdentifiedResource`. */
export function getAbout(obj: EObject | undefined | null): string {
  const about = eget(obj, 'about');
  return typeof about === 'string' ? about : '';
}

/** Formatiert Byte-Größe menschenlesbar. */
export function formatBytes(bytes: number | string | undefined): string {
  if (!bytes) return '';
  const b = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
  if (isNaN(b)) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Datum aus einem `DateOrDateTimeLiteral` als `TT.MM.JJJJ`, sonst unverändert. */
export function formatDate(value: string | undefined | null): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  return `${match[3]}.${match[2]}.${match[1]}`;
}
