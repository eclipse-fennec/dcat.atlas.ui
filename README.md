# DCAT-AP Viewer

Katalog-Browser für ein **[Fennec DCAT.Atlas](https://github.com/eclipse-fennec/dcat.atlas)**
Open-Data-Portal. Vue 3 + Vite, EMF-Modelle über
[EMFTs](https://github.com/eclipse-fennec/emf.ts).

Der Viewer liest die Leseseite der DCAT.Atlas-REST-API als
`application/xmi` — die Kodierung des EMF-Modells selbst — und parst sie mit
EMFTS wieder zu EObjects. Es gibt keine Zwischen-DTO-Schicht: was im Portal
gespeichert ist, ist im Browser dasselbe Objektgeflecht.

## Voraussetzung: ein laufendes Portal

Am schnellsten die gehostete Instanz — sie schickt CORS-Header, ein Proxy ist
dafür nicht nötig:

```bash
VITE_DCAT_API=https://dcat.modelatlas.cloud/rest npm run dev
```

Lokal per bnd:

```
org.eclipse.fennec.dcat.atlas.runtime/local.bndrun     # -> http://localhost:8085/dcat/rest
```

Oder als Container (`docker/dockercompose/docker-compose.yml`) — der serviert
`/rest` **ohne** das `/dcat`-Segment, auf Port 8080.

## Starten

```bash
npm install
npm run dev            # http://localhost:5173
```

Der Dev-Server proxyt `/dcat` auf das Portal. Ziel per Umgebungsvariable
(siehe `.env.example`):

```bash
DCAT_ATLAS_URL=http://localhost:8085 npm run dev
```

**Warum ein Proxy?** Das Portal setzt keine CORS-Header. Ein direkter
Cross-Origin-Zugriff scheitert daher, und selbst mit CORS wären die
Paging-Header `X-Total-Count` und `Link` ohne
`Access-Control-Expose-Headers` für den Browser unsichtbar.

### Produktionsbau

`npm run build` erzeugt statische Dateien ohne Proxy. Dafür entweder

* die gebauten Dateien hinter denselben Reverse-Proxy hängen, der das Portal
  unter `/dcat/rest` (bzw. `/rest`) ausliefert, oder
* `VITE_DCAT_API` auf die absolute Basis setzen — dann muss das Portal CORS
  beherrschen, inklusive `Access-Control-Expose-Headers: X-Total-Count, Link`.

Der Kontextpfad ist Konfiguration, keine Konstante: `local.bndrun` liefert
`/dcat/rest`, das Container-Image `/rest`.

## Was der Viewer nutzt

| Endpunkt | wofür |
|---|---|
| `GET /catalogs` | Kopfbereich und Katalog-Übersicht |
| `GET /datasets?limit=&after=` | Datensatzliste, cursor-basiert geblättert |
| `GET /data-services` | Dienste-Tab |
| `GET /datasets/{id}/distributions` | Nachschlag, falls eine Antwort die Distributions nicht einbettet |

### Zwei Antwortformen

Eine **Einzelressource** ist die blanke Wurzel:

```xml
<dcat:Catalog about="https://…/rest/catalogs/b7a8…">…</dcat:Catalog>
```

Eine **Sammlung** steckt im Fennec-Umschlag:

```xml
<util:Response resultSize="1">
  <data xsi:type="dcat:Catalog" about="https://…/rest/catalogs/b7a8…">…</data>
</util:Response>
```

`model/utilities.ecore` ist der Ausschnitt des Fennec-Utilities-Modells, den
EMFTS zum Parsen dieses Umschlags braucht — das Original liegt nicht im
veröffentlichten Bundle, dort steht nur generierter Java-Code.

### Was die API zusagt

* **`204 No Content`** bei leerer Sammlung — kein Body, kein Parsen.
* **Die Gesamtzahl** liest der Viewer aus `resultSize` im Antwortkörper, nicht
  aus `X-Total-Count`: der Header steht bei der Cloud-Instanz *nicht* in
  `Access-Control-Expose-Headers` und ist Cross-Origin darum unsichtbar. Der
  Header dient nur als Rückfallebene.
* **`Link … rel="next"`** ist das Ende-Signal: fehlt er, war es die letzte
  Seite. Der Viewer übernimmt den `after`-Cursor daraus und baut ihn nicht
  selbst, weil ein Offset beim Einfügen oder Löschen verrutscht.
* Member-Referenzen (`<dataset href="…#/"/>`) zeigen über Dokumentgrenzen und
  bleiben Proxies — der Viewer liest die Sammlungen direkt statt sie
  aufzulösen.

Die Suche und der Kategorienfilter arbeiten über die geladenen Datensätze; die
API kennt keine Volltextsuche. Über 300 Einträge hinaus wird per
„Weitere laden“ nachgeblättert.

## Verwaltung (Schreibseite)

Ein **eigener Bereich unter `#/verwalten`**, nicht im Lese-Menü — erreichbar
über den Link im Footer. Die Verwaltung hat mit dem Blättern im Katalog nichts
zu tun und sie schreibt; sie steht darum hinter einer eigenen Adresse
(verlinkbar, aber niemand stolpert beim Stöbern hinein).

> **Das ist keine Zugriffskontrolle.** Ein clientseitig versteckter Bereich
> schützt nichts — der Schutz gehört vor `/admin`. Genau dort sitzt er bei der
> gehosteten Instanz auch (Basic-Auth im Gateway).

Angelegt werden **Katalog**, **Datensatz** und **Distribution**: Formular,
Trockenlauf gegen `POST /admin/validate/{collection}`, dann `POST`. Ein
Datensatz kann direkt in einen Katalog gehängt werden
(`PUT /admin/catalogs/{id}/datasets/{datasetId}`). Eine Vorschau zeigt den
Rumpf, der tatsächlich rausgeht.

Was das Modell verlangt, prüft das Formular vorab: Katalog und Datensatz
brauchen Titel, Beschreibung und Herausgeber; eine Distribution mindestens eine
`accessURL` und eine `license` (beide `lowerBound="1"`). Bei Distributionen sind
`title` und `description` **einwertig** — anders als bei Katalog und Datensatz,
wo mehrere Sprachen erlaubt sind. Die Formatauswahl belegt den Medientyp vor,
überschreibt aber keine Eingabe von Hand.

Eine Distribution hat **keine eigene Collection**: sie ist Containment im
Datensatz und wird unter `POST /admin/datasets/{datasetId}/distributions`
angelegt, mit entsprechend genisteter Identität.

**Der XMI-Rumpf wird von Hand gebaut** (`src/api/xmiBuilder.ts`), nicht von
EMFTS serialisiert. Grund: der XMI-Writer von EMFTS erzeugt für diese Ecores
die RDF/XML-artige Form (`<ns:title xml:lang="de">Text</ns:title>`,
`rdf:about`), der Server erwartet die flache EMF-Form
(`<title lang="de" value="Text"/>`, `about`) und quittiert die andere mit
**500**. Keine Save-Option ändert das. Gelesen wird beides korrekt — die
Asymmetrie betrifft nur das Schreiben.

**Zwei Grenzen:**

* **Cross-Origin geht nicht.** Die API erlaubt per CORS `GET, HEAD, OPTIONS`;
  ein Schreibzugriff aus dem Browser auf ein fremdes Origin wird blockiert,
  bevor der Server ihn sieht. Die Schreibseite ist praktisch nur same-origin
  erreichbar, also über den Dev-Proxy.
* **`/admin` kann hinter einem Gateway liegen.** Die gehostete Instanz verlangt
  dort Basic-Auth (`401`); lokal ist sie offen. Eine Anmeldemaske gibt es
  nicht — die hängt davon ab, was das Gateway erwartet.

Fehler werden übersetzt statt durchgereicht: `409` nennt die Ressource, die im
Weg ist, `422` heißt „nichts gespeichert", `415` erinnert an
`application/xmi`, `404` auf einem Admin-Pfad heißt oft, dass der
Validierungsdienst fehlt und sich die Schreibdienste abgemeldet haben.

## SPARQL-Ansicht

Der Tab „SPARQL" fragt über `POST /sparql` den gesamten Bestand ab — das, was
Content-Negotiation auf einer einzelnen Ressource nicht kann. Beispielabfragen
sind hinterlegt, das Katalog-Beispiel wird mit einem echten Graphnamen gefüllt.

`Accept` nennt beide Familien mit Gewichtung
(`application/sparql-results+json, text/turtle;q=0.9`); der Server wählt nach
Query-Form, und die Antwort wird am Content-Type auseinandergehalten — nicht
daran, was der Client in der Abfrage zu erkennen glaubt.

**Zwei Fallen, auf die die Ansicht hinweist:**

* **Der Default-Graph ist leer.** Jede Ressource liegt in ihrem eigenen
  benannten Graphen, `SELECT * WHERE { ?s ?p ?o }` trifft also garantiert
  nichts. Die Ansicht warnt, wenn eine Abfrage kein `GRAPH` nennt.
* **Eine Distribution erscheint in zwei Graphen** — ihrem eigenen und dem ihres
  Datensatzes, weil sie Containment ist. `COUNT(?d)` zählt darum
  Graph-Vorkommen; gemeint ist fast immer `COUNT(DISTINCT ?d)`.

Statuscodes werden übersetzt statt durchgereicht: `503` heißt „Projektion wird
noch gebaut" und ist absichtlich *keine* leere Ergebnismenge, `404` heißt
„SPARQL ist in diesem Deployment abgeschaltet", `400` bekommt auch ein
`UPDATE` — der Endpunkt parst, ist also lesend by construction.

## Modelle

`model/` enthält bitgleiche Kopien der Ecores aus
`org.eclipse.fennec.dcat.atlas.dcatap.de.model/model`, gespiegelt nach
`public/model/` (von dort lädt der Browser). **Diese Kopien müssen mit dem
Server übereinstimmen** — die EClasses entscheiden, ob das ausgelieferte XMI
überhaupt parst.

Das Modell ist flach: `title`, `description`, `keyword` sind
`rdf:PlainLiteral` (`value` + `lang`), `theme`, `format`, `language`,
`accrualPeriodicity` sind blanke IRIs. `src/emf/vocab.ts` übersetzt die
gängigen EU-Authority-Codes ins Deutsche.

## Container

```bash
cd deploy && docker compose up -d --build     # http://localhost:8081/
```

Das Image trägt die gebaute App und ein nginx, das `/dcat/` an das Portal
weiterreicht. Die Portal-Adresse ist **Laufzeit**-Konfiguration, keine
Build-Konfiguration:

| Variable | Bedeutung | Default |
| --- | --- | --- |
| `DCAT_ATLAS_URL` | Basis, unter der `/rest` und `/health` des Portals liegen — mit abschließendem Schrägstrich | `http://host.docker.internal:8080/` |
| `DCAT_ATLAS_HOST` | `host[:port]` genau dieser URL, als `Host`-Header geschickt | `host.docker.internal:8080` |
| `DCAT_ATLAS_AUTH` | vollständiger `Authorization`-Header, falls das Portal einen verlangt | leer |
| `UI_PORT` | Host-Port (nur Compose) | `8081` |

Dasselbe Image zeigt damit auf jedes Portal:

```bash
DCAT_ATLAS_URL=https://dcat.modelatlas.cloud/ \
DCAT_ATLAS_HOST=dcat.modelatlas.cloud \
docker compose up -d
```

`VITE_DCAT_API` wird beim Bauen bewusst **nicht** gesetzt — es würde in die
Bundles eingebacken und ein Image pro Portal erzwingen. Der Client fällt
stattdessen auf `/dcat/rest` zurück, also denselben Origin. Das ist nicht nur
bequemer: die API schickt keine CORS-Header und erlaubt nur `GET`, `HEAD` und
`OPTIONS`, ein Cross-Origin-Schreibzugriff scheitert also schon im Browser.
Über den Proxy bleibt die Verwaltung erreichbar.

Die Absicherung der Schreibseite liegt damit beim Portal oder einem
vorgelagerten Gateway — dieser Container reicht alle Methoden weiter.

`DCAT_ATLAS_URL` ist die Basis *inklusive* Kontextpfad: für das Portal-Image
(`CONTEXT_PATH=/`) die blanke Wurzel, für einen bndrun-Lauf mit Kontextpfad
`/dcat` entsprechend `http://host:8085/dcat/`.

Gebaut und veröffentlicht wird über `.github/workflows/images.yml` nach
`ghcr.io/eclipse-fennec/dcat.atlas.ui`, getaggt mit Commit-SHA, Branch und
Paketversion; `latest` nur vom Standard-Branch. Die Reihenfolge ist bauen →
starten → prüfen → pushen, damit kein ungetestetes Image in der Registry landet.

## EMFTs-Abhängigkeiten

Die drei EMFTs-Pakete kommen aus der npm-Registry, exakt gepinnt:

| Paket | Version |
| --- | --- |
| `@emfts/core` | `0.2.0-next.1` |
| `@emfts/vue-registry` | `0.0.1-next.1` |
| `@emfts/uimodel-composer` | `0.0.2-next.1` |

Exakte Versionen statt `^`-Bereiche, weil es Vorabversionen sind — bei
Prereleases greifen semver-Bereiche nicht so, wie man es erwartet. Zum Anheben
die Version in `package.json` setzen und `npm install` laufen lassen; welche
Vorabversion die neueste ist, sagt `npm view @emfts/core dist-tags`.

`@emfts/uimodel-composer` und `@emfts/vue-registry` bringen jeweils eine eigene,
ältere `@emfts/core` mit. Das ist gewollt und funktioniert: der Bootstrap in
`src/emf/loadResources.ts` setzt `UimodelPackage.eINSTANCE` ausdrücklich in die
Registry der äußeren `@emfts/core`.

Gegen einen lokalen EMFTs-Baum entwickeln, ohne die gepinnten Versionen
anzufassen:

```bash
npm install --no-save ../EMFTs/emfts ../EMFTs/emfts-vue-registry \
                      ../EMFTs/uimodel-composer/packages/uimodel-composer
rm -rf node_modules/.vite && npm run dev
```

`--no-save` hält `package.json` und `package-lock.json` frei von `file:`-Verweisen.
Zurück auf die publizierten Pakete: `npm ci`.

## Aufbau

```
src/api/dcatAtlas.ts    REST-Client: Paging, Content-Negotiation, XMI -> EObject
src/emf/loadResources.ts Ecore- und UIModel-Bootstrap
src/emf/eObjectUtils.ts  EMF-Reflection: Literale, Sprachen, Datumsangaben
src/emf/vocab.ts         IRI -> Beschriftung (Themen, Frequenzen, Lizenzen)
src/App.vue              Portal-Oberfläche
src/components/          Datensatz-Karte und Detailansicht
```
