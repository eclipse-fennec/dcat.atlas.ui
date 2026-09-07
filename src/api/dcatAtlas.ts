/**
 * Lesender Client für die DCAT.Atlas-REST-API.
 *
 * Gelesen wird durchgängig `application/xmi` — das ist die Kodierung des
 * EMF-Modells selbst, also genau das, was EMFTS ohne Zwischenschicht parst.
 * Die RDF-Syntaxen (Turtle, JSON-LD, …) wären für einen RDF-Konsumenten
 * richtig; hier soll aus der Antwort aber wieder ein EObject werden.
 *
 * Endpunkte (Leseseite, siehe `docs/opendata-portal-user-guide.md`):
 *   GET /catalogs · /datasets · /dataset-series · /data-services
 *   GET /{collection}/{id}
 *   GET /datasets/{datasetId}/distributions
 *
 * Zwei Antwortformen, die man auseinanderhalten muss:
 *   - eine **Einzelressource** ist die blanke Wurzel, `<dcat:Catalog about="…">`;
 *   - eine **Sammlung** steckt im Fennec-Umschlag
 *     `<util:Response resultSize="N"><data xsi:type="dcat:Catalog" …/>…</util:Response>`.
 */
import { URI } from '@emfts/core';
import type { EObject } from '@emfts/core';
import type { BasicResourceSet, XMIResource } from '@emfts/core';

/** Die vier Sammlungen mit eigenem Pfad. */
export type DcatCollection = 'catalogs' | 'datasets' | 'dataset-series' | 'data-services';

/**
 * Was der Trockenlauf prüfen kann. `distributions` ist dabei, obwohl es keine
 * eigene Lese-Collection hat — eine Distribution gehört immer in ihr Dataset.
 */
export type ValidatableCollection = DcatCollection | 'distributions';

/** nsURI des Fennec-Utilities-Modells, dessen `Response` Sammlungen umschließt. */
const UTIL_NS = 'https://org.eclipse/fennec/utils/1.0';

export interface PageResult {
  items: EObject[];
  /**
   * Die ganze Sammlung, nicht die Seite.
   *
   * Quelle ist `resultSize` aus dem Antwortkörper, nicht `X-Total-Count`:
   * der Header steht bei einem Cross-Origin-Zugriff nicht in
   * `Access-Control-Expose-Headers` und ist für den Browser dann unsichtbar.
   * Der Header dient nur als Rückfallebene.
   */
  total: number;
  /**
   * Cursor der Folgeseite (`after`), oder `null` auf der letzten Seite.
   * Ein kurzer Seiteninhalt ist kein Ende — das Fehlen von `rel="next"` ist es.
   */
  nextCursor: string | null;
}

/** Eine Zelle einer SELECT-Ergebniszeile, im SPARQL-1.1-Results-Format. */
export interface SparqlCell {
  type: 'uri' | 'literal' | 'bnode' | 'typed-literal';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

/**
 * Das Ergebnis einer Abfrage — welche Form es hat, entscheidet die Query:
 * `SELECT` und `ASK` liefern Ergebnismengen (kein RDF, daher eigene
 * Medientypen), `CONSTRUCT` und `DESCRIBE` liefern einen Graphen.
 */
export type SparqlResult =
  | { kind: 'table'; vars: string[]; rows: Array<Record<string, SparqlCell | undefined>> }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'graph'; contentType: string; text: string };

/** Ergebnis eines Trockenlaufs gegen `POST /admin/validate/{collection}`. */
export interface ValidationOutcome {
  conforms: boolean;
  /** Der SHACL-Report in der ausgehandelten RDF-Syntax. */
  report: string;
}

/** Ergebnis eines erfolgreichen `POST /admin/{collection}`. */
export interface CreateOutcome {
  id: string;
  location: string;
  etag: string | null;
}

export class DcatAtlasError extends Error {
  constructor(readonly status: number, readonly url: string, message: string) {
    super(message);
    this.name = 'DcatAtlasError';
  }
}

/**
 * Basis-URL der API. Ohne Konfiguration der Vite-Proxy-Pfad `/dcat/rest`,
 * der auf den lokalen bndrun-Port 8085 zeigt (siehe `vite.config.ts`) — die
 * API schickt keine CORS-Header, ein Direktzugriff aus dem Browser scheitert
 * also am Origin.
 */
export const API_BASE: string = (
  (import.meta.env.VITE_DCAT_API as string | undefined) ?? '/dcat/rest'
).replace(/\/+$/, '');

/** Der `{id}` aus einem `about` bzw. einer Lese-URL: letztes Segment ohne Fragment. */
export function idOf(aboutOrUrl: string | undefined | null): string {
  if (!aboutOrUrl) return '';
  const withoutFragment = aboutOrUrl.split('#')[0].replace(/\/+$/, '');
  return decodeURIComponent(withoutFragment.substring(withoutFragment.lastIndexOf('/') + 1));
}

export class DcatAtlasClient {
  /** Zähler, damit jede Antwort eine eigene Resource-URI bekommt. */
  private seq = 0;

  constructor(
    private readonly rs: BasicResourceSet,
    private readonly loadOptions: Map<string, any>,
    readonly base: string = API_BASE
  ) {}

  /** Eine Seite einer Sammlung. `limit` wird serverseitig auf 1…500 geklemmt. */
  async list(
    collection: DcatCollection,
    opts: { after?: string | null; limit?: number } = {}
  ): Promise<PageResult> {
    const url = new URL(`${this.base}/${collection}`, window.location.href);
    if (opts.limit != null) url.searchParams.set('limit', String(opts.limit));
    if (opts.after) url.searchParams.set('after', opts.after);

    const res = await this.request(url.toString());
    // Eine leere Sammlung (und ein Cursor hinter dem Ende) ist 204 ohne Body.
    if (res.status === 204) return { items: [], total: this.headerTotal(res), nextCursor: null };

    const roots = await this.parse(res, url.toString());
    const { items, resultSize } = unwrapResponse(roots);
    return {
      items,
      total: resultSize ?? this.headerTotal(res) ?? items.length,
      nextCursor: nextCursor(res),
    };
  }

  /**
   * Alle Seiten einer Sammlung, bis erschöpft oder `maxItems` erreicht.
   *
   * Die API kennt keine Volltextsuche; Suche und Facetten im Viewer arbeiten
   * deshalb über das, was geladen ist. `nextCursor !== null` heißt: es gibt
   * noch mehr, der Aufrufer kann nachladen.
   */
  async listAll(
    collection: DcatCollection,
    opts: { pageSize?: number; maxItems?: number; after?: string | null } = {}
  ): Promise<PageResult> {
    const pageSize = opts.pageSize ?? 100;
    const maxItems = opts.maxItems ?? 500;
    const items: EObject[] = [];
    let after = opts.after ?? null;
    let total = 0;

    // Harte Schleifenbremse: der Cursor kommt vom Server, eine Fehlfunktion
    // dort soll den Browser nicht endlos laufen lassen.
    for (let guard = 0; guard < 100; guard++) {
      const page = await this.list(collection, { after, limit: pageSize });
      total = page.total;
      items.push(...page.items);
      after = page.nextCursor;
      if (!after || items.length >= maxItems) break;
    }
    return { items, total, nextCursor: after };
  }

  /** Eine einzelne Ressource, oder `null` bei 404. */
  async get(collection: DcatCollection, id: string): Promise<EObject | null> {
    const url = `${this.base}/${collection}/${encodeURIComponent(id)}`;
    const res = await this.request(url, { allow404: true });
    if (!res || res.status === 204) return null;
    const { items } = unwrapResponse(await this.parse(res, url));
    return items[0] ?? null;
  }

  /**
   * Die Distributions eines Datasets.
   *
   * Distributions sind Containment: im XMI eines Datasets stehen sie schon
   * drin. Dieser Endpunkt ist der Nachschlag für den Fall, dass eine
   * Listenantwort sie nicht mitliefert.
   */
  async distributions(datasetId: string): Promise<EObject[]> {
    const url = `${this.base}/datasets/${encodeURIComponent(datasetId)}/distributions`;
    const res = await this.request(url, { allow404: true });
    if (!res || res.status === 204) return [];
    return unwrapResponse(await this.parse(res, url)).items;
  }

  /**
   * Eine SPARQL-1.1-Abfrage über den gesamten Bestand.
   *
   * Der Endpunkt ist **lesend by construction**: er parst die Abfrage, ein
   * `UPDATE` scheitert daher schon an der Syntaxprüfung statt an einer Regel,
   * die jemand falsch konfigurieren könnte.
   *
   * `Accept` nennt beide Familien mit Gewichtung — der Server wählt nach
   * Query-Form: Ergebnismenge für SELECT/ASK, Turtle für CONSTRUCT/DESCRIBE.
   * Die Antwort wird am Content-Type auseinandergehalten, nicht daran, was
   * wir in der Abfrage zu erkennen glauben.
   */
  async sparql(query: string): Promise<SparqlResult> {
    const url = `${this.base}/sparql`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          Accept: 'application/sparql-results+json, text/turtle;q=0.9',
        },
        body: query,
      });
    } catch {
      throw new DcatAtlasError(0, url, `Die DCAT.Atlas-API unter ${this.base} ist nicht erreichbar.`);
    }

    if (!res.ok) {
      const body = (await res.text().catch(() => '')).trim();
      throw new DcatAtlasError(res.status, url, sparqlErrorMessage(res.status, body));
    }

    const contentType = res.headers.get('Content-Type') ?? '';
    if (contentType.includes('sparql-results+json')) {
      const json: any = await res.json();
      if (typeof json.boolean === 'boolean') return { kind: 'boolean', value: json.boolean };
      return {
        kind: 'table',
        vars: json.head?.vars ?? [],
        rows: json.results?.bindings ?? [],
      };
    }
    return { kind: 'graph', contentType, text: await res.text() };
  }

  // ------------------------------------------------------------- Schreibseite
  //
  // Alles unter `/admin`. Ein vorgeschaltetes Gateway darf das absichern — die
  // gehostete Instanz tut das per Basic-Auth und erlaubt per CORS ohnehin nur
  // GET/HEAD/OPTIONS. Aus dem Browser heraus ist die Schreibseite deshalb
  // praktisch nur same-origin erreichbar, also über den Dev-Proxy.

  /**
   * Trockenlauf: validiert, ohne zu speichern.
   *
   * Antwortet immer `200` mit einem SHACL-Report; ob er konform ist, steht im
   * Header `X-SHACL-Conforms`. Ohne konfigurierte Shapes meldet er Konformität,
   * weil er nichts zu vergleichen hat — das ist keine Zusicherung.
   */
  async validate(collection: ValidatableCollection, xmi: string): Promise<ValidationOutcome> {
    const url = `${this.base}/admin/validate/${collection}`;
    const res = await this.write(url, 'POST', xmi, 'text/turtle');
    return {
      conforms: res.headers.get('X-SHACL-Conforms') === 'true',
      report: (await res.text()).trim(),
    };
  }

  /**
   * Legt eine Ressource an. `201` mit `Location` und `ETag`.
   *
   * `Accept` ist bewusst `application/rdf+xml`: die Admin-Ressourcen
   * produzieren nur XMI, JSON, XML und RDF/XML — ein `text/turtle` quittieren
   * sie mit 406, obwohl der User-Guide etwas anderes nahelegt.
   */
  async create(collection: DcatCollection, xmi: string): Promise<CreateOutcome> {
    const url = `${this.base}/admin/${collection}`;
    const res = await this.write(url, 'POST', xmi, 'application/rdf+xml');
    const location = res.headers.get('Location') ?? '';
    return { id: idOf(location), location, etag: res.headers.get('ETag') };
  }

  /**
   * Legt eine Distribution in ihrem Datensatz an.
   *
   * Eine Distribution hat **keine eigene Collection**: sie ist Containment im
   * Dataset und wird darum in dessen Kontext erzeugt. `404` heißt hier, dass
   * es den Datensatz nicht gibt — eine Verteilung kann nicht vor dem
   * entstehen, was sie verteilt.
   */
  async createDistribution(datasetId: string, xmi: string): Promise<CreateOutcome> {
    const url = `${this.base}/admin/datasets/${encodeURIComponent(datasetId)}/distributions`;
    const res = await this.write(url, 'POST', xmi, 'application/rdf+xml');
    const location = res.headers.get('Location') ?? '';
    return { id: idOf(location), location, etag: res.headers.get('ETag') };
  }

  /** Hängt einen bestehenden Datensatz in einen Katalog. Ohne Body. */
  async linkDatasetToCatalog(catalogId: string, datasetId: string): Promise<void> {
    const url = `${this.base}/admin/catalogs/${encodeURIComponent(catalogId)}/datasets/${encodeURIComponent(datasetId)}`;
    await this.write(url, 'PUT', null, 'application/rdf+xml');
  }

  /** Gemeinsamer Schreibpfad mit übersetzter Fehlerlage. */
  private async write(
    url: string,
    method: 'POST' | 'PUT',
    body: string | null,
    accept: string
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Accept: accept,
          // Nur setzen, wenn es auch einen Body gibt: ein leerer PUT mit
          // Content-Type ist unnötig und provoziert bei manchen Gateways einen
          // Preflight, den die Leseseite nicht erlaubt.
          ...(body == null ? {} : { 'Content-Type': 'application/xmi' }),
        },
        ...(body == null ? {} : { body }),
      });
    } catch {
      throw new DcatAtlasError(0, url, writeUnreachableMessage(this.base));
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).trim();
      throw new DcatAtlasError(res.status, url, writeErrorMessage(res, text));
    }
    return res;
  }

  /** Liveness/Readiness liegen neben `/rest`, nicht darunter. */
  async ready(): Promise<boolean> {
    const url = `${this.base.replace(/\/rest$/, '')}/health/ready`;
    try {
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async request(
    url: string,
    opts: { allow404?: boolean } = {}
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/xmi' } });
    } catch (cause) {
      throw new DcatAtlasError(
        0,
        url,
        `Die DCAT.Atlas-API unter ${this.base} ist nicht erreichbar.`
      );
    }
    if (res.status === 404 && opts.allow404) return res;
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '');
      throw new DcatAtlasError(res.status, url, `HTTP ${res.status} von ${url}${body ? `: ${body.slice(0, 300)}` : ''}`);
    }
    return res;
  }

  /**
   * Antwort-XMI in EObjects verwandeln.
   *
   * Jede Antwort bekommt eine eigene Resource im gemeinsamen ResourceSet, damit
   * die EPackages greifen. Die URI ist die Request-URL plus laufende Nummer:
   * absolut (also greift die http/https-Factory) und eindeutig, sodass ein
   * Reload die vorherige Antwort nicht überschreibt.
   */
  private async parse(res: Response, requestUrl: string): Promise<EObject[]> {
    const text = await res.text();
    if (!text.trim()) return [];

    const absolute = new URL(requestUrl, window.location.href);
    absolute.searchParams.set('_r', String(++this.seq));
    const resource = this.rs.createResource(URI.createURI(absolute.toString())) as XMIResource;
    resource.loadFromString(text, this.loadOptions);

    const errors = resource.getErrors();
    if (errors.length > 0) {
      console.warn(`Fehler beim Parsen von ${requestUrl}:`, errors);
    }
    return Array.from(resource.getContents());
  }

  /** `X-Total-Count`, sofern der Browser ihn überhaupt sehen darf. */
  private headerTotal(res: Response): number {
    const raw = res.headers.get('X-Total-Count');
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
}

/**
 * Warum ein Schreibversuch gar nicht erst rausging.
 *
 * Aus dem Browser scheitert ein Cross-Origin-Schreibzugriff an CORS, bevor der
 * Server ihn sieht: die Leseseite erlaubt `GET, HEAD, OPTIONS` und sonst
 * nichts. Same-Origin — also über den Dev-Proxy — tritt das nicht auf.
 */
function writeUnreachableMessage(base: string): string {
  const crossOrigin = /^https?:\/\//i.test(base) && !base.startsWith(window.location.origin);
  return crossOrigin
    ? `Schreibzugriff auf ${base} wurde vom Browser blockiert. Die API erlaubt per CORS nur GET, HEAD und OPTIONS — die Schreibseite ist aus dem Browser nur same-origin erreichbar, also über den Dev-Proxy.`
    : `Die DCAT.Atlas-API unter ${base} ist nicht erreichbar.`;
}

/** Die Fehlerlage eines Schreibversuchs in einen Satz übersetzen. */
function writeErrorMessage(res: Response, body: string): string {
  const detail = body ? `\n\n${body.slice(0, 1200)}` : '';
  switch (res.status) {
    case 400:
      return `Die Anfrage wurde abgelehnt. Häufigste Ursachen: ein \`about\`, das nicht diesem Portal gehört, oder ein Property-Name, den das Modell nicht kennt.${detail}`;
    case 401:
    case 403:
      return `Die Schreibseite verlangt eine Anmeldung — sie liegt hinter einem Gateway. Lesen bleibt offen.${detail}`;
    case 404:
      return `Der Endpunkt gibt es nicht. Bei den Admin-Pfaden heißt das oft: der Validierungsdienst fehlt, dann melden sich die Schreibdienste ab. \`GET /health/ready\` erklärt es.${detail}`;
    case 406:
      return `Der Endpunkt kann das angefragte Format nicht liefern.${detail}`;
    case 409: {
      const where = res.headers.get('Location');
      return `Diese Identität ist schon vergeben.${where ? ` Im Weg: ${where}` : ''} Entweder eine andere Id wählen oder die vorhandene Ressource ändern.${detail}`;
    }
    case 415:
      return `Der Server nimmt nur \`application/xmi\` an.${detail}`;
    case 422:
      return `Die Validierung hat abgelehnt — nichts wurde gespeichert.${detail}`;
    default:
      return `HTTP ${res.status}.${detail}`;
  }
}

/**
 * Die Fehlerlage eines SPARQL-Aufrufs in einen Satz übersetzen.
 *
 * Die Statuscodes tragen hier eine besondere Bedeutung, die man nicht
 * verschlucken darf: `503` heißt „Projektion wird noch gebaut" und ist
 * absichtlich *keine* leere Ergebnismenge — die wäre von „nichts passt" nicht
 * zu unterscheiden.
 */
function sparqlErrorMessage(status: number, body: string): string {
  const detail = body ? ` ${body.slice(0, 400)}` : '';
  switch (status) {
    case 400:
      return `Die Abfrage wurde nicht angenommen. Der Endpunkt liest nur — ein UPDATE scheitert hier an der Syntaxprüfung.${detail}`;
    case 404:
      return 'SPARQL ist in diesem Deployment abgeschaltet.';
    case 503:
      return 'Die RDF-Projektion wird gerade aufgebaut. Gleich nochmal versuchen.';
    case 500:
      return `Die Ausführung ist fehlgeschlagen oder hat das Zeitlimit von 30 Sekunden gerissen.${detail}`;
    default:
      return `HTTP ${status}.${detail}`;
  }
}

/**
 * Den Fennec-`util:Response`-Umschlag abnehmen, falls einer da ist.
 *
 * Sammlungen kommen als eine Wurzel `Response` mit `data`-Containment und
 * `resultSize`; eine Einzelressource kommt blank. Beides darf hier ankommen,
 * damit die Aufrufer nicht wissen müssen, welche Form der Endpunkt liefert.
 */
function unwrapResponse(roots: EObject[]): { items: EObject[]; resultSize: number | null } {
  if (roots.length === 1 && isResponse(roots[0])) {
    const wrapper = roots[0] as any;
    const dataFeature = wrapper.eClass()?.getEStructuralFeature?.('data');
    const data = dataFeature ? wrapper.eGet(dataFeature) : null;
    const items: EObject[] =
      data == null ? [] : Symbol.iterator in Object(data) ? Array.from(data) : [data];

    const sizeFeature = wrapper.eClass()?.getEStructuralFeature?.('resultSize');
    const raw = sizeFeature ? wrapper.eGet(sizeFeature) : null;
    const size = Number(raw);
    return { items, resultSize: Number.isFinite(size) ? size : null };
  }
  return { items: roots, resultSize: null };
}

function isResponse(obj: EObject): boolean {
  const eClass = obj?.eClass?.() as any;
  return eClass?.getName?.() === 'Response' && eClass?.getEPackage?.()?.getNsURI?.() === UTIL_NS;
}

/**
 * Der `after`-Cursor aus dem `Link`-Header mit `rel="next"`.
 *
 * Gelesen wird nur der Cursor, nicht die ganze URL: der Server rendert seine
 * Links unter der konfigurierten `PUBLIC_BASE_URL`, die hinter dem Dev-Proxy
 * eine andere ist als die, die der Browser aufruft. Der Cursor selbst ist
 * die Angabe, die man nicht selbst bauen darf — der kommt von hier.
 */
function nextCursor(res: Response): string | null {
  const header = res.headers.get('Link');
  if (!header) return null;
  for (const part of header.split(/,(?=\s*<)/)) {
    if (!/rel\s*=\s*"?next"?/i.test(part)) continue;
    const target = part.match(/<([^>]*)>/)?.[1];
    if (!target) continue;
    const after = /[?&]after=([^&]*)/.exec(target)?.[1];
    if (after) return decodeURIComponent(after);
  }
  return null;
}
