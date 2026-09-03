<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, shallowRef } from 'vue';
import type { EObject } from '@emfts/core';
import DatasetCard from './components/DatasetCard.vue';
import DatasetDetail from './components/DatasetDetail.vue';
import SparqlView from './components/SparqlView.vue';
import AdminView from './components/AdminView.vue';
import { eget, asList, getLabel, getAllLabels, getAbout, formatDate, referenceUris } from './emf/eObjectUtils';
import { themeLabel } from './emf/vocab';
import { DcatAtlasClient, DcatAtlasError, API_BASE, idOf } from './api/dcatAtlas';
import { loadModels } from './emf/loadResources';

/** Wie viele Einträge je Sammlung initial geladen werden. */
const PAGE_SIZE = 100;
const INITIAL_DATASETS = 300;

type Phase = 'loading' | 'ready' | 'error';

const phase = ref<Phase>('loading');
const errorMessage = ref('');
const errorDetail = ref('');
const errorHint = ref('');

// EObjects sind nicht reaktiv zu tracken — shallowRef hält Vue davon ab,
// das ganze EMF-Objektgeflecht in Proxies zu wickeln.
const client = shallowRef<DcatAtlasClient | null>(null);
const catalogs = shallowRef<EObject[]>([]);
const datasets = shallowRef<EObject[]>([]);
const services = shallowRef<EObject[]>([]);

const datasetTotal = ref(0);
const serviceTotal = ref(0);
const catalogTotal = ref(0);
const datasetCursor = ref<string | null>(null);
const loadingMore = ref(false);

async function load() {
  phase.value = 'loading';
  errorMessage.value = '';
  errorDetail.value = '';
  errorHint.value = '';
  try {
    const ctx = await loadModels();
    const api = new DcatAtlasClient(ctx.resourceSet, ctx.loadOptions);
    client.value = api;

    const [cat, ds, svc] = await Promise.all([
      api.listAll('catalogs', { pageSize: 50, maxItems: 50 }),
      api.listAll('datasets', { pageSize: PAGE_SIZE, maxItems: INITIAL_DATASETS }),
      api.listAll('data-services', { pageSize: PAGE_SIZE, maxItems: 200 }),
    ]);

    catalogs.value = cat.items;
    catalogTotal.value = cat.total;
    datasets.value = ds.items;
    datasetTotal.value = ds.total;
    datasetCursor.value = ds.nextCursor;
    services.value = svc.items;
    serviceTotal.value = svc.total;

    phase.value = 'ready';
  } catch (err) {
    phase.value = 'error';
    if (err instanceof DcatAtlasError) {
      errorMessage.value =
        err.status === 0
          ? `Die DCAT.Atlas-API unter ${API_BASE} ist nicht erreichbar.`
          : `Die API antwortete mit HTTP ${err.status}.`;
      errorDetail.value = `Angefragt: ${err.url}`;
      // 0 heißt Verbindungsfehler im Browser, 5xx bekommt man vom Dev-Proxy
      // gemeldet, wenn das Portal dahinter nicht läuft.
      if (err.status === 0 || err.status >= 500) {
        errorHint.value =
          `Läuft der Portal-Server? Der Dev-Proxy leitet ${API_BASE} an DCAT_ATLAS_URL weiter ` +
          '(Standard http://localhost:8085, der lokale bndrun-Lauf).';
      }
    } else {
      errorMessage.value = err instanceof Error ? err.message : String(err);
      errorDetail.value = 'Beim Laden der Metamodelle ist ein Fehler aufgetreten.';
    }
    console.error('Laden fehlgeschlagen:', err);
  }
}

/** Nächste Seite der Datasets anhängen (Cursor kommt vom Server). */
async function loadMoreDatasets() {
  const api = client.value;
  if (!api || !datasetCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const page = await api.listAll('datasets', {
      pageSize: PAGE_SIZE,
      maxItems: INITIAL_DATASETS,
      after: datasetCursor.value,
    });
    datasets.value = [...datasets.value, ...page.items];
    datasetCursor.value = page.nextCursor;
    datasetTotal.value = page.total;
  } catch (err) {
    console.error('Nachladen fehlgeschlagen:', err);
  } finally {
    loadingMore.value = false;
  }
}

/**
 * Die Verwaltung ist ein eigener Bereich, kein Tab.
 *
 * Sie hat mit dem Blättern im Katalog nichts zu tun, und sie schreibt. Darum
 * liegt sie hinter einer eigenen Adresse (`#/verwalten`) statt neben den
 * Lese-Tabs: verlinkbar, aber niemand stolpert beim Stöbern hinein.
 */
const AREA_ADMIN = 'verwalten';
const areaFromHash = () => window.location.hash.replace(/^#\/?/, '');
const area = ref(areaFromHash());
const isAdminArea = computed(() => area.value === AREA_ADMIN);

function syncArea() {
  area.value = areaFromHash();
}
onMounted(() => window.addEventListener('hashchange', syncArea));
onUnmounted(() => window.removeEventListener('hashchange', syncArea));

onMounted(load);

/**
 * Die Sammlungen neu holen, nachdem etwas angelegt wurde. Anders als `load()`
 * bleibt der Modellstand stehen — die Ecores ändern sich nicht.
 */
async function reload() {
  const api = client.value;
  if (!api) return;
  try {
    const [cat, ds, svc] = await Promise.all([
      api.listAll('catalogs', { pageSize: 50, maxItems: 50 }),
      api.listAll('datasets', { pageSize: PAGE_SIZE, maxItems: INITIAL_DATASETS }),
      api.listAll('data-services', { pageSize: PAGE_SIZE, maxItems: 200 }),
    ]);
    catalogs.value = cat.items;
    catalogTotal.value = cat.total;
    datasets.value = ds.items;
    datasetTotal.value = ds.total;
    datasetCursor.value = ds.nextCursor;
    services.value = svc.items;
    serviceTotal.value = svc.total;
  } catch (err) {
    console.error('Neu laden fehlgeschlagen:', err);
  }
}

// ---------------------------------------------------------------- Kopfbereich

/** Ein Katalog trägt den Kopf; bei mehreren bleibt es beim Portalnamen. */
const leadCatalog = computed(() => (catalogs.value.length === 1 ? catalogs.value[0] : null));
const portalTitle = computed(() =>
  leadCatalog.value ? getLabel(leadCatalog.value, 'title') : 'DCAT.Atlas — Open-Data-Portal'
);
const portalDescription = computed(() =>
  leadCatalog.value ? getLabel(leadCatalog.value, 'description') : ''
);
const portalPublisher = computed(() =>
  leadCatalog.value ? getLabel(eget(leadCatalog.value, 'publisher'), 'name') : ''
);

// ------------------------------------------------------------------- Filterung

const searchQuery = ref('');
const selectedTheme = ref<string | null>(null);
const selectedCatalog = ref<string | null>(null);

/**
 * Die Filter greifen gestaffelt ineinander, damit die Zähler an den Facetten
 * stimmen: jede Facette zählt, was die *anderen* Filter übrig lassen — sonst
 * verspricht ein Eintrag Treffer, die es in der Kombination nicht gibt.
 *
 *   bySearch  ->  byCatalog  ->  filteredDatasets (Kategorie)
 *      |              |
 *      |              +-- Grundmenge der Kategorie-Zähler
 *      +-- Grundmenge der Katalog-Zähler
 */
const bySearch = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return datasets.value;
  return datasets.value.filter((ds) => {
    const haystack = [
      getLabel(ds, 'title'),
      getLabel(ds, 'description'),
      getAllLabels(ds, 'keyword').join(' '),
      getLabel(eget(ds, 'publisher'), 'name'),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
});

/**
 * Welche Datensätze in welchem Katalog liegen, steht in den Katalogen selbst:
 * `dcat:dataset` verweist per `href` auf die Datensatz-Dokumente. Die API
 * kennt kein `?catalog=`-Filter, also wird hier zusammengeführt, was ohnehin
 * schon geladen ist — ohne einen einzigen zusätzlichen Request.
 *
 * **Unterkataloge zählen mit.** `dcat:catalog` verweist auf Kataloge, die
 * ihrerseits Datensätze führen; `GET /catalogs` liefert sie flach als eigene
 * Einträge, die Schachtelung steckt allein in diesen Referenzen. Ein Filter,
 * der nur die direkten Mitglieder nähme, würde bei einem Elternkatalog
 * verschweigen, was in seinen Kindern liegt.
 */
const catalogFacets = computed(() => {
  const byId = new Map<string, EObject>();
  for (const cat of catalogs.value) byId.set(idOf(getAbout(cat)), cat);

  // Kindbeziehungen einsammeln; nur Kataloge, die auch geladen sind.
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const [id, cat] of byId) {
    const kids = referenceUris(cat, 'catalog')
      .map(idOf)
      .filter((k) => k !== id && byId.has(k));
    children.set(id, kids);
    for (const k of kids) hasParent.add(k);
  }

  /**
   * Datensätze eines Katalogs samt aller Unterkataloge.
   *
   * `seen` wird über den ganzen Abstieg geteilt: das bricht Zyklen (das Modell
   * verbietet sie nicht) und besucht einen mehrfach eingehängten Unterkatalog
   * nur einmal — für eine Menge von Ids ist das dasselbe Ergebnis, nur ohne
   * die exponentielle Wiederholung.
   */
  function collect(id: string, seen: Set<string>): Set<string> {
    const out = new Set<string>();
    if (seen.has(id)) return out;
    seen.add(id);
    const cat = byId.get(id);
    if (!cat) return out;
    for (const uri of referenceUris(cat, 'dataset')) out.add(idOf(uri));
    for (const kid of children.get(id) ?? []) {
      for (const d of collect(kid, seen)) out.add(d);
    }
    return out;
  }

  const loaded = bySearch.value.map((ds) => idOf(getAbout(ds)));

  // Als Baum ausgeben: Wurzeln zuerst, Kinder eingerückt. Wurzel ist, was
  // keinen geladenen Elternkatalog hat — bei einem reinen Zyklus bliebe die
  // Menge leer, dann wird flach gelistet, damit nichts verschwindet.
  const roots = Array.from(byId.keys()).filter((id) => !hasParent.has(id));
  const order = roots.length > 0 ? roots : Array.from(byId.keys());

  const rows: Array<{ id: string; title: string; depth: number; count: number; children: number }> = [];
  const emitted = new Set<string>();
  function emit(id: string, depth: number, path: Set<string>) {
    if (path.has(id) || emitted.has(id)) return;
    emitted.add(id);
    const cat = byId.get(id)!;
    const members = collect(id, new Set());
    rows.push({
      id,
      title: getLabel(cat, 'title') || id,
      depth,
      count: loaded.filter((d) => members.has(d)).length,
      children: (children.get(id) ?? []).length,
    });
    const nextPath = new Set(path).add(id);
    for (const kid of children.get(id) ?? []) emit(kid, depth + 1, nextPath);
  }
  for (const id of order) emit(id, 0, new Set());
  // Was durch einen Zyklus nie erreicht wurde, hinten anhängen statt verlieren.
  for (const id of byId.keys()) if (!emitted.has(id)) emit(id, 0, new Set());

  return rows.map((row) => ({
    ...row,
    members: collect(row.id, new Set()),
  }));
});

const byCatalog = computed(() => {
  if (!selectedCatalog.value) return bySearch.value;
  const facet = catalogFacets.value.find((f) => f.id === selectedCatalog.value);
  if (!facet) return bySearch.value;
  return bySearch.value.filter((ds) => facet.members.has(idOf(getAbout(ds))));
});

/** Themen kommen als IRI; gruppiert wird über die Beschriftung. */
const allThemes = computed(() => {
  const counts = new Map<string, number>();
  for (const ds of byCatalog.value) {
    for (const t of asList(eget(ds, 'theme'))) {
      const label = themeLabel(String(t));
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], 'de'));
});

const filteredDatasets = computed(() => {
  if (!selectedTheme.value) return byCatalog.value;
  return byCatalog.value.filter((ds) =>
    asList(eget(ds, 'theme')).some((t) => themeLabel(String(t)) === selectedTheme.value)
  );
});

/** Alle Filter zurücksetzen — für den Fall, dass die Kombination leer läuft. */
const hasFilter = computed(() => !!(searchQuery.value.trim() || selectedTheme.value || selectedCatalog.value));
function clearFilters() {
  searchQuery.value = '';
  selectedTheme.value = null;
  selectedCatalog.value = null;
}

// -------------------------------------------------------------------- Auswahl

const selectedDataset = shallowRef<EObject | null>(null);
type Tab = 'datasets' | 'services' | 'catalogs' | 'sparql';
const activeTab = ref<Tab>('datasets');

function selectDataset(ds: EObject) {
  selectedDataset.value = ds;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearSelection() {
  selectedDataset.value = null;
}

function switchTab(tab: Tab) {
  activeTab.value = tab;
  clearSelection();
}

/** Deutsche Ein-/Mehrzahl: „1 Datensatz“ statt „1 Datensätze“. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ------------------------------------------------------------------- Anzeigen

/** Einmal pro Laden aufbereitet statt bei jedem Render der Vorlage. */
const serviceViews = computed(() =>
  services.value.map((svc) => ({
    key: getAbout(svc),
    title: getLabel(svc, 'title'),
    description: getLabel(svc, 'description'),
    publisher: getLabel(eget(svc, 'publisher'), 'name'),
    endpoints: asList(eget(svc, 'endpointURL')).map(String).filter(Boolean),
    endpointDescriptions: asList(eget(svc, 'endpointDescription')).map(String).filter(Boolean),
  }))
);

/**
 * Der Kataloge-Tab folgt derselben Reihenfolge und Tiefe wie die Facette,
 * damit die Schachtelung an beiden Stellen gleich aussieht. `GET /catalogs`
 * liefert sie flach — die Hierarchie kommt allein aus `dcat:catalog`.
 */
const catalogViews = computed(() => {
  const byId = new Map(catalogs.value.map((cat) => [idOf(getAbout(cat)), cat]));
  return catalogFacets.value.map((facet) => {
    const cat = byId.get(facet.id)!;
    return {
      key: facet.id,
      title: facet.title,
      depth: facet.depth,
      children: facet.children,
      datasets: facet.members.size,
      description: getLabel(cat, 'description'),
      publisher: getLabel(eget(cat, 'publisher'), 'name'),
      homepage: String(eget(cat, 'homepage') ?? ''),
      modified: formatDate(getLabel(cat, 'modified')),
      id: facet.id,
    };
  });
});
</script>

<template>
  <div class="app">
    <!-- Ladezustand -->
    <div v-if="phase === 'loading'" class="state state--loading">
      <div class="spinner" aria-hidden="true"></div>
      <p>Katalog wird von <code>{{ API_BASE }}</code> geladen…</p>
    </div>

    <!-- Fehlerzustand -->
    <div v-else-if="phase === 'error'" class="state state--error">
      <h1>Der Katalog konnte nicht geladen werden</h1>
      <p class="state__message">{{ errorMessage }}</p>
      <p v-if="errorDetail" class="state__detail">{{ errorDetail }}</p>
      <p v-if="errorHint" class="state__detail">{{ errorHint }}</p>
      <button class="state__retry" @click="load()">Erneut versuchen</button>
    </div>

    <!-- Verwaltung: eigener Bereich unter #/verwalten, nicht im Lese-Menü -->
    <template v-else-if="isAdminArea">
      <header class="adminbar">
        <div class="adminbar__inner">
          <a href="#/" class="adminbar__back">&larr; Zurück zum Portal</a>
          <h1 class="adminbar__title">Verwaltung</h1>
          <span class="adminbar__hint">Schreibzugriff auf <code>{{ API_BASE }}/admin</code></span>
        </div>
      </header>
      <main class="main">
        <AdminView
          :client="client"
          :catalogs="catalogs"
          :datasets="datasets"
          @created="reload()"
        />
      </main>
      <footer class="footer">
        DCAT.Atlas-API: <code>{{ API_BASE }}</code>
      </footer>
    </template>

    <template v-else>
      <!-- Header / Hero -->
      <header class="hero">
        <div class="hero__content">
          <h1 class="hero__title">{{ portalTitle }}</h1>
          <p class="hero__desc">{{ portalDescription }}</p>
          <div class="hero__search">
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Datensätze durchsuchen…"
              class="search-input"
            />
          </div>
          <div class="hero__meta">
            <template v-if="portalPublisher">
              <span>{{ portalPublisher }}</span>
              <span class="hero__separator">·</span>
            </template>
            <span>{{ count(datasetTotal, 'Datensatz', 'Datensätze') }}</span>
            <span class="hero__separator">·</span>
            <span>{{ count(serviceTotal, 'Dienst', 'Dienste') }}</span>
            <span class="hero__separator">·</span>
            <span>{{ count(catalogTotal, 'Katalog', 'Kataloge') }}</span>
          </div>
        </div>
      </header>

      <!-- Navigation -->
      <nav class="nav">
        <button
          :class="['nav__tab', { 'nav__tab--active': activeTab === 'datasets' }]"
          @click="switchTab('datasets')"
        >
          Datensätze ({{ filteredDatasets.length }})
        </button>
        <button
          :class="['nav__tab', { 'nav__tab--active': activeTab === 'services' }]"
          @click="switchTab('services')"
        >
          Dienste ({{ services.length }})
        </button>
        <button
          :class="['nav__tab', { 'nav__tab--active': activeTab === 'catalogs' }]"
          @click="switchTab('catalogs')"
        >
          Kataloge ({{ catalogs.length }})
        </button>
        <button
          :class="['nav__tab', { 'nav__tab--active': activeTab === 'sparql' }]"
          @click="switchTab('sparql')"
        >
          SPARQL
        </button>
      </nav>

      <main class="main">
        <!-- Datensatz-Detailansicht -->
        <div v-if="selectedDataset" class="detail-wrapper">
          <div class="breadcrumb">
            <button class="breadcrumb__back" @click="clearSelection()">
              &larr; Zurück zur Übersicht
            </button>
          </div>
          <DatasetDetail :dataset="selectedDataset" :client="client" />
        </div>

        <!-- Datensatz-Liste -->
        <template v-else-if="activeTab === 'datasets'">
          <aside class="sidebar">
            <!-- Katalog-Facette nur, wenn es überhaupt etwas zu unterscheiden gibt. -->
            <template v-if="catalogFacets.length > 1">
              <h3 class="sidebar__title">Katalog</h3>
              <ul class="sidebar__list sidebar__list--spaced">
                <li>
                  <button
                    :class="['sidebar__item', { 'sidebar__item--active': !selectedCatalog }]"
                    @click="selectedCatalog = null"
                  >
                    Alle Kataloge ({{ bySearch.length }})
                  </button>
                </li>
                <li v-for="cat in catalogFacets" :key="cat.id">
                  <button
                    :class="['sidebar__item', { 'sidebar__item--active': selectedCatalog === cat.id }]"
                    :style="{ paddingLeft: `${0.7 + cat.depth * 0.9}rem` }"
                    :title="cat.depth > 0 ? 'Unterkatalog' : undefined"
                    @click="selectedCatalog = cat.id"
                  >
                    <span v-if="cat.depth > 0" class="sidebar__nest" aria-hidden="true">└</span>
                    {{ cat.title }} ({{ cat.count }})
                  </button>
                </li>
              </ul>
            </template>

            <h3 class="sidebar__title">Kategorien</h3>
            <ul class="sidebar__list">
              <li>
                <button
                  :class="['sidebar__item', { 'sidebar__item--active': !selectedTheme }]"
                  @click="selectedTheme = null"
                >
                  Alle ({{ byCatalog.length }})
                </button>
              </li>
              <li v-for="[theme, count] in allThemes" :key="theme">
                <button
                  :class="['sidebar__item', { 'sidebar__item--active': selectedTheme === theme }]"
                  @click="selectedTheme = theme"
                >
                  {{ theme }} ({{ count }})
                </button>
              </li>
            </ul>

            <button v-if="hasFilter" class="sidebar__reset" @click="clearFilters()">
              Filter zurücksetzen
            </button>
          </aside>

          <div class="dataset-grid">
            <DatasetCard
              v-for="ds in filteredDatasets"
              :key="getAbout(ds) || String(ds)"
              :dataset="ds"
              @select="selectDataset(ds)"
            />
            <p v-if="filteredDatasets.length === 0" class="no-results">
              {{ hasFilter ? 'Kein Datensatz passt zu dieser Auswahl.' : 'Keine Datensätze vorhanden.' }}
            </p>
            <div v-if="datasetCursor" class="load-more">
              <p class="load-more__hint">
                {{ datasets.length }} von {{ datasetTotal }} Datensätzen geladen — die
                Suche greift auf das Geladene zu.
              </p>
              <button class="load-more__button" :disabled="loadingMore" @click="loadMoreDatasets()">
                {{ loadingMore ? 'Wird geladen…' : 'Weitere laden' }}
              </button>
            </div>
          </div>
        </template>

        <!-- Dienste -->
        <template v-else-if="activeTab === 'services'">
          <div class="service-list">
            <article v-for="svc in serviceViews" :key="svc.key" class="service-card">
              <h3 class="service-card__title">{{ svc.title || 'Ohne Titel' }}</h3>
              <p v-if="svc.description" class="service-card__desc">{{ svc.description }}</p>
              <dl class="service-card__dl">
                <template v-if="svc.publisher"><dt>Herausgeber</dt><dd>{{ svc.publisher }}</dd></template>
                <template v-for="url in svc.endpoints" :key="url">
                  <dt>Endpoint</dt>
                  <dd><a :href="url" target="_blank" rel="noopener"><code>{{ url }}</code></a></dd>
                </template>
                <template v-for="url in svc.endpointDescriptions" :key="url">
                  <dt>Beschreibung</dt>
                  <dd><a :href="url" target="_blank" rel="noopener"><code>{{ url }}</code></a></dd>
                </template>
              </dl>
            </article>
            <p v-if="services.length === 0" class="no-results">Keine Dienste vorhanden.</p>
          </div>
        </template>

        <!-- Kataloge -->
        <template v-else-if="activeTab === 'catalogs'">
          <div class="service-list">
            <article
              v-for="cat in catalogViews"
              :key="cat.key"
              class="service-card"
              :class="{ 'service-card--nested': cat.depth > 0 }"
              :style="{ marginLeft: `${cat.depth * 2}rem` }"
            >
              <h3 class="service-card__title">
                {{ cat.title || 'Ohne Titel' }}
                <span v-if="cat.depth > 0" class="service-card__badge">Unterkatalog</span>
              </h3>
              <p v-if="cat.description" class="service-card__desc">{{ cat.description }}</p>
              <dl class="service-card__dl">
                <template v-if="cat.publisher"><dt>Herausgeber</dt><dd>{{ cat.publisher }}</dd></template>
                <template v-if="cat.homepage">
                  <dt>Homepage</dt>
                  <dd><a :href="cat.homepage" target="_blank" rel="noopener">{{ cat.homepage }}</a></dd>
                </template>
                <template v-if="cat.modified"><dt>Geändert</dt><dd>{{ cat.modified }}</dd></template>
                <template v-if="cat.children">
                  <dt>Unterkataloge</dt>
                  <dd>{{ cat.children }}</dd>
                </template>
                <template v-if="cat.datasets">
                  <dt>Datensätze</dt>
                  <dd>{{ cat.datasets }}<span v-if="cat.children"> (mit Unterkatalogen)</span></dd>
                </template>
                <template v-if="cat.id"><dt>Id</dt><dd><code>{{ cat.id }}</code></dd></template>
              </dl>
            </article>
            <p v-if="catalogs.length === 0" class="no-results">Keine Kataloge vorhanden.</p>
          </div>
        </template>

        <!-- SPARQL -->
        <template v-else>
          <SparqlView :client="client" :catalogs="catalogs" />
        </template>
      </main>

      <footer class="footer">
        DCAT.Atlas-API: <code>{{ API_BASE }}</code>
        <span class="footer__sep">·</span>
        <a href="#/verwalten" class="footer__admin">Verwaltung</a>
      </footer>
    </template>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #f0f2f5; color: #1a1a2e; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }

.app { min-height: 100vh; display: flex; flex-direction: column; }

/* Lade- und Fehlerzustand */
.state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; padding: 4rem 2rem; text-align: center; }
.state code { background: #e6eaee; padding: .15rem .45rem; border-radius: 4px; font-size: .85em; }
.state--error h1 { font-size: 1.3rem; color: #991b1b; }
.state__message { font-size: .95rem; color: #334; max-width: 640px; }
.state__detail { font-size: .85rem; color: #667; max-width: 640px; }
.state__retry { padding: .55rem 1.2rem; border: 1px solid #2563eb; background: #2563eb; color: #fff; border-radius: 6px; cursor: pointer; font-size: .9rem; }
.state__retry:hover { background: #1d4ed8; }
.spinner { width: 28px; height: 28px; border: 3px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Hero */
/* Hero, Nav, Main und Footer teilen sich Breite und Innenabstand, damit alle
   dieselbe linke Kante haben. Die Fließtextbreite begrenzt stattdessen .hero__desc. */
.hero { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: #fff; padding: 2.5rem 0 2rem; }
.hero__content { max-width: 1200px; margin: 0 auto; padding: 0 2rem; }
.hero__title { font-size: 1.6rem; font-weight: 700; margin-bottom: .5rem; }
.hero__desc { font-size: .92rem; opacity: .9; line-height: 1.5; margin-bottom: 1.2rem; max-width: 46rem; }
.hero__search { margin-bottom: .8rem; }
.search-input {
  width: 100%; max-width: 500px; padding: .65rem 1rem; border: none; border-radius: 8px;
  font-size: .95rem; background: rgba(255,255,255,.95); color: #1a1a2e;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
}
.search-input:focus { outline: 2px solid #60a5fa; }
.hero__meta { font-size: .82rem; opacity: .7; }
.hero__separator { margin: 0 .4rem; }

/* Nav */
.nav { background: #fff; border-bottom: 1px solid #e2e6ea; padding: 0 2rem; display: flex; gap: .5rem; max-width: 1200px; width: 100%; margin: 0 auto; }
.nav__tab {
  padding: .75rem 1.2rem; border: none; background: none; cursor: pointer;
  font-size: .9rem; color: #556; border-bottom: 2px solid transparent; transition: all .15s;
}
.nav__tab:hover { color: #2563eb; }
.nav__tab--active { color: #2563eb; border-bottom-color: #2563eb; font-weight: 600; }

/* Main */
.main { max-width: 1200px; width: 100%; margin: 0 auto; padding: 1.5rem 2rem; display: flex; gap: 2rem; flex: 1; }

/* Footer */
.footer { max-width: 1200px; width: 100%; margin: 0 auto; padding: 1rem 2rem 2rem; font-size: .78rem; color: #5f6b78; }
.footer code { background: #e6eaee; padding: .12rem .4rem; border-radius: 4px; }

/* Detail Wrapper */
/* Lesbare Spaltenbreite, aber linksbündig an derselben Kante wie die Tabs. */
.detail-wrapper { flex: 1; max-width: 50rem; }

/* Sidebar */
.sidebar { flex: 0 0 220px; }
.sidebar__title { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #778; margin-bottom: .6rem; font-weight: 700; }
.sidebar__list { list-style: none; }
.sidebar__item {
  display: block; width: 100%; text-align: left; padding: .45rem .7rem; border: none;
  background: none; cursor: pointer; font-size: .88rem; border-radius: 6px; color: #445; transition: all .12s;
}
.sidebar__item:hover { background: #e8ecf0; }
.sidebar__item--active { background: #dbeafe; color: #2563eb; font-weight: 600; }
.sidebar__list--spaced { margin-bottom: 1.4rem; }
.sidebar__nest { color: #9aa4ae; margin-right: .15rem; }
.sidebar__reset {
  margin-top: 1.2rem; padding: .35rem .7rem; border: 1px solid #cbd5e1; background: #fff;
  border-radius: 6px; cursor: pointer; font-size: .8rem; color: #475569;
}
.sidebar__reset:hover { background: #f1f5f9; }

/* Dataset Grid */
.dataset-grid { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; align-content: start; }

/* Nachladen */
.load-more { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: .6rem; padding: 1.5rem 0; }
.load-more__hint { font-size: .82rem; color: #778; }
.load-more__button { padding: .5rem 1.1rem; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; cursor: pointer; font-size: .88rem; color: #2563eb; }
.load-more__button:hover:not(:disabled) { background: #eff6ff; }
.load-more__button:disabled { opacity: .6; cursor: default; }

/* Dataset Card */
.dataset-card {
  background: #fff; border-radius: 10px; padding: 1.2rem 1.4rem; cursor: pointer;
  border: 1px solid #e2e6ea; transition: box-shadow .15s, border-color .15s;
  display: flex; flex-direction: column; gap: .6rem;
}
.dataset-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.08); border-color: #bcc4ce; }
.dataset-card--active { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.2); }
.dataset-card__header { display: flex; flex-direction: column; gap: .2rem; }
.dataset-card__title { font-size: 1rem; font-weight: 600; color: #1a1a2e; line-height: 1.3; }
/* Der Titel ist ein Button, sieht aber aus wie eine Überschrift. */
.dataset-card__open {
  all: unset; cursor: pointer; display: block; width: 100%;
  font: inherit; color: inherit; text-align: left;
}
.dataset-card__open:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; border-radius: 3px; }
.dataset-card:hover .dataset-card__open { color: #2563eb; }
.dataset-card__publisher { font-size: .78rem; color: #778; }
.dataset-card__desc { font-size: .85rem; color: #556; line-height: 1.4; }
.dataset-card__meta { display: flex; flex-wrap: wrap; gap: .3rem; }
.dataset-card__footer { display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: .5rem; }
.dataset-card__formats { display: flex; gap: .3rem; flex-wrap: wrap; }
.dataset-card__date { font-size: .75rem; color: #6b7280; }

/* Tags */
.tag {
  display: inline-block; padding: .2rem .65rem; border-radius: 20px; font-size: .78rem; font-weight: 500;
}
.tag--theme { background: #dbeafe; color: #1e40af; }
.tag--keyword { background: #f0fdf4; color: #166534; }

/* Format Badge */
.format-badge {
  display: inline-block; padding: .2rem .6rem; border-radius: 4px; font-size: .72rem;
  font-weight: 700; text-transform: uppercase; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;
}
.format-badge--lg { font-size: .8rem; padding: .3rem .8rem; }

/* Breadcrumb */
.breadcrumb { margin-bottom: 1.5rem; }
.breadcrumb__back {
  background: none; border: none; cursor: pointer; color: #2563eb; font-size: .9rem;
  padding: .4rem 0; display: inline-flex; align-items: center; gap: .4rem;
}
.breadcrumb__back:hover { text-decoration: underline; }

/* Detail */
.detail { width: 100%; }
.detail__header { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #e2e6ea; }
.detail__title { font-size: 1.5rem; font-weight: 700; margin-bottom: .3rem; color: #1a1a2e; }
.detail__publisher { font-size: .9rem; color: #556; }
.detail__iri { display: inline-block; margin-top: .4rem; font-size: .75rem; color: #5b6673; word-break: break-all; }
.detail__byline { font-weight: 600; color: #556; }
.detail__label { font-weight: 600; color: #778; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
.detail__section { background: #fff; border-radius: 10px; padding: 1.4rem 1.8rem; border: 1px solid #e2e6ea; margin-bottom: 1.2rem; }
.detail__section-title { font-size: .82rem; font-weight: 700; color: #1e3a5f; margin-bottom: 1rem; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #eef1f5; padding-bottom: .6rem; }
.detail__description { font-size: .95rem; line-height: 1.7; color: #334; white-space: pre-line; }
.detail__hint { font-size: .82rem; color: #667080; margin-bottom: .8rem; line-height: 1.5; }
.detail__hint--after { margin: .7rem 0 0; }
.detail__hint code { background: #f1f5f9; padding: .1rem .35rem; border-radius: 3px; }
.detail__field { margin-bottom: .8rem; }
.detail__field:last-child { margin-bottom: 0; }
.detail__tags { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .4rem; }
.detail__dl { display: grid; grid-template-columns: 180px 1fr; gap: .5rem 1rem; font-size: .9rem; }
.detail__dl dt { color: #778; font-weight: 500; }
.detail__dl dd { color: #223; font-weight: 500; word-break: break-word; }

/* Distribution Cards */
.dist-list { display: flex; flex-direction: column; gap: 1rem; }
.dist-card { background: #f8fafc; border-radius: 10px; padding: 1.2rem 1.5rem; border: 1px solid #e2e8f0; }
.dist-card__header { display: flex; align-items: center; gap: .8rem; margin-bottom: .5rem; }
.dist-card__title { font-size: .95rem; font-weight: 600; color: #1a1a2e; }
.dist-card__desc { font-size: .85rem; color: #556; margin-bottom: .7rem; line-height: 1.5; }
.dist-card__dl { display: grid; grid-template-columns: 120px 1fr; gap: .3rem .8rem; font-size: .85rem; margin-bottom: .7rem; }
.dist-card__dl dt { color: #778; }
.dist-card__dl dd { color: #334; font-weight: 500; word-break: break-word; }
.dist-card__links { display: flex; gap: .5rem; flex-wrap: wrap; }
.dist-link {
  display: inline-block; padding: .3rem .8rem; border-radius: 6px; font-size: .82rem; font-weight: 500;
  background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; transition: all .12s;
}
.dist-link:hover { background: #dbeafe; text-decoration: none; }
.dist-link--download { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
.dist-link--download:hover { background: #dcfce7; }

/* Service / Katalog Cards */
.service-list { flex: 1; display: flex; flex-direction: column; gap: 1rem; }
.service-card { background: #fff; border-radius: 10px; padding: 1.2rem 1.5rem; border: 1px solid #e2e6ea; }
.service-card__title { font-size: 1.1rem; font-weight: 600; margin-bottom: .4rem; }
.service-card--nested { border-left: 3px solid #bfdbfe; }
.service-card__badge {
  margin-left: .5rem; padding: .1rem .5rem; border-radius: 20px; font-size: .68rem;
  font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  background: #eff6ff; color: #1d4ed8; vertical-align: middle;
}
.service-card__desc { font-size: .88rem; color: #556; margin-bottom: .7rem; line-height: 1.5; }
.service-card__dl { display: grid; grid-template-columns: 130px 1fr; gap: .3rem .6rem; font-size: .88rem; }
.service-card__dl dt { color: #778; font-weight: 500; }
.service-card__dl dd { word-break: break-all; }
.service-card__dl dd code { background: #f1f5f9; padding: .2rem .5rem; border-radius: 4px; font-size: .82rem; }

/* Field Widget */
.field { display: flex; flex-direction: column; gap: .25rem; }
.field__label { font-size: .75rem; font-weight: 600; color: #556; text-transform: uppercase; letter-spacing: .04em; }
.field__input { padding: .5rem .75rem; border: 1px solid #ccd; border-radius: 6px; font-size: .92rem; }
.field__input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
.field__value { font-size: .92rem; color: #334; padding: .3rem 0; }
.field--readonly .field__value { color: #556; }

/* SPARQL-Ansicht */
.sparql { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .9rem; }
.sparql__intro { font-size: .88rem; color: #445; line-height: 1.6; max-width: 46rem; }
.sparql__intro code, .sparql__warning code, .sparql__meta code {
  background: #eef1f5; padding: .1rem .35rem; border-radius: 3px; font-size: .9em;
}
.sparql__examples { display: flex; flex-wrap: wrap; gap: .4rem; }
.sparql__example {
  padding: .3rem .75rem; border: 1px solid #cbd5e1; background: #fff; border-radius: 20px;
  cursor: pointer; font-size: .8rem; color: #334;
}
.sparql__example:hover { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
.sparql__input {
  width: 100%; padding: .9rem 1rem; border: 1px solid #cbd5e1; border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .84rem;
  line-height: 1.6; resize: vertical; background: #fff; color: #1a1a2e; tab-size: 2;
}
.sparql__input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
.sparql__actions { display: flex; align-items: center; gap: .8rem; }
.sparql__run {
  padding: .5rem 1.2rem; border: 1px solid #2563eb; background: #2563eb; color: #fff;
  border-radius: 6px; cursor: pointer; font-size: .88rem;
}
.sparql__run:hover:not(:disabled) { background: #1d4ed8; }
.sparql__run:disabled { opacity: .6; cursor: default; }
.sparql__hint { font-size: .78rem; color: #667080; }
.sparql__warning {
  font-size: .82rem; color: #854d0e; background: #fefce8; border: 1px solid #fde68a;
  border-radius: 6px; padding: .6rem .8rem; line-height: 1.5;
}
.sparql__error {
  font-size: .85rem; color: #991b1b; background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 6px; padding: .7rem .9rem; line-height: 1.5; white-space: pre-wrap;
}
.sparql__meta { font-size: .8rem; color: #667080; }
.sparql__boolean { font-size: .95rem; font-weight: 600; color: #1a1a2e; }
/* Breite Ergebnisse scrollen in sich, die Seite selbst nicht. */
.sparql__tablewrap { overflow-x: auto; border: 1px solid #e2e6ea; border-radius: 8px; background: #fff; }
.sparql__table { border-collapse: collapse; width: 100%; font-size: .82rem; }
.sparql__table th, .sparql__table td {
  text-align: left; padding: .5rem .8rem; border-bottom: 1px solid #eef1f5;
  vertical-align: top; max-width: 34rem; word-break: break-word;
}
.sparql__table th { background: #f8fafc; font-weight: 600; color: #475569; white-space: nowrap; }
.sparql__table tr:last-child td { border-bottom: none; }
.sparql__graph {
  overflow-x: auto; background: #fff; border: 1px solid #e2e6ea; border-radius: 8px;
  padding: 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .78rem; line-height: 1.5; color: #223; max-height: 32rem;
}

/* Kopfleiste des Verwaltungsbereichs — bewusst nüchtern, damit man sieht,
   dass man nicht mehr im Lesebereich ist. */
.adminbar { background: #1e293b; color: #e2e8f0; padding: 1rem 0; }
.adminbar__inner { max-width: 1200px; margin: 0 auto; padding: 0 2rem; display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
.adminbar__back { color: #93c5fd; font-size: .85rem; }
.adminbar__title { font-size: 1.15rem; font-weight: 700; }
.adminbar__hint { font-size: .78rem; color: #94a3b8; margin-left: auto; }
.adminbar__hint code { background: #334155; padding: .1rem .4rem; border-radius: 4px; }

.footer__sep { margin: 0 .5rem; }
.footer__admin { color: #5f6b78; text-decoration: underline; }
.footer__admin:hover { color: #2563eb; }

/* Verwalten-Ansicht */
.admin { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1rem; }
.admin__intro { font-size: .88rem; color: #445; line-height: 1.6; max-width: 46rem; }
.admin__note {
  font-size: .82rem; color: #475569; background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 6px; padding: .6rem .8rem; margin-bottom: 1rem; line-height: 1.5;
}
.admin__intro code, .admin__meta code {
  background: #eef1f5; padding: .1rem .35rem; border-radius: 3px; font-size: .9em;
}
.admin__kinds { display: flex; gap: .4rem; }
.admin__kind {
  padding: .4rem 1.1rem; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px;
  cursor: pointer; font-size: .88rem; color: #334;
}
.admin__kind:hover { background: #f1f5f9; }
.admin__kind--active { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }

.admin__form { background: #fff; border: 1px solid #e2e6ea; border-radius: 10px; padding: 1.4rem 1.6rem; }
.admin__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: 1rem 1.4rem; }
.field2 { display: flex; flex-direction: column; gap: .3rem; min-width: 0; }
.field2--wide { grid-column: 1 / -1; }
.field2__label { font-size: .78rem; font-weight: 600; color: #556; text-transform: uppercase; letter-spacing: .04em; }
.field2__label em { font-style: normal; color: #b45309; margin-left: .3rem; font-weight: 500; text-transform: none; letter-spacing: 0; }
.field2__input {
  padding: .5rem .7rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: .9rem;
  font-family: inherit; background: #fff; color: #1a1a2e; width: 100%;
}
.field2__input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
textarea.field2__input { resize: vertical; line-height: 1.5; }

.admin__themes { border: 1px solid #e2e6ea; border-radius: 8px; padding: .8rem 1rem; }
.admin__themes legend { padding: 0 .3rem; }
.admin__theme { display: inline-flex; align-items: center; gap: .35rem; font-size: .85rem; color: #334; margin: .25rem 1rem .25rem 0; cursor: pointer; }

.admin__missing { margin-top: 1rem; font-size: .82rem; color: #854d0e; background: #fefce8; border: 1px solid #fde68a; border-radius: 6px; padding: .6rem .8rem; line-height: 1.5; }
.admin__actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin-top: 1.2rem; }
.admin__check, .admin__toggle {
  padding: .5rem 1.1rem; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px;
  cursor: pointer; font-size: .88rem; color: #334;
}
.admin__check:hover:not(:disabled), .admin__toggle:hover { background: #f1f5f9; }
.admin__save {
  padding: .5rem 1.3rem; border: 1px solid #2563eb; background: #2563eb; color: #fff;
  border-radius: 6px; cursor: pointer; font-size: .88rem; font-weight: 600;
}
.admin__save:hover:not(:disabled) { background: #1d4ed8; }
.admin__check:disabled, .admin__save:disabled { opacity: .55; cursor: default; }

.admin__message {
  font-size: .85rem; line-height: 1.6; border-radius: 6px; padding: .8rem 1rem;
  white-space: pre-wrap; word-break: break-word;
}
.admin__message--ok { color: #14532d; background: #f0fdf4; border: 1px solid #bbf7d0; }
.admin__message--warn { color: #854d0e; background: #fefce8; border: 1px solid #fde68a; }
.admin__message--error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; }
.admin__meta { font-size: .8rem; color: #667080; }
.admin__xmi {
  overflow-x: auto; background: #fff; border: 1px solid #e2e6ea; border-radius: 8px;
  padding: 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .78rem; line-height: 1.5; color: #223; max-height: 26rem;
}

.no-results { font-size: .92rem; color: #778; padding: 2rem; text-align: center; grid-column: 1 / -1; }
</style>
