<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import type { EObject } from '@emfts/core';
import { DcatAtlasError } from '../api/dcatAtlas';
import type { DcatAtlasClient, SparqlResult, SparqlCell } from '../api/dcatAtlas';
import { getAbout, getLabel } from '../emf/eObjectUtils';

const props = defineProps<{
  client: DcatAtlasClient | null;
  /** Für das Beispiel „Datensätze eines Katalogs“ — mit echtem Graphnamen. */
  catalogs: EObject[];
}>();

/**
 * Ein Graphname *ist* eine Lese-URL des Portals. Deshalb lässt sich das
 * Katalog-Beispiel mit einem echten Namen füllen, statt einen Platzhalter
 * zu zeigen, den man erst ersetzen muss.
 */
const sampleCatalog = computed(() => {
  const first = props.catalogs[0];
  return first ? getAbout(first) : 'http://localhost:8085/dcat/rest/catalogs/beispiel';
});
const sampleCatalogTitle = computed(() =>
  props.catalogs[0] ? getLabel(props.catalogs[0], 'title') : ''
);

const EXAMPLES = computed(() => [
  {
    name: 'Welche Ressourcen gibt es?',
    query: `# Jede Ressource liegt in ihrem eigenen benannten Graphen,
# und der Default-Graph ist leer — ohne GRAPH trifft nichts zu.
SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }`,
  },
  {
    name: 'Alle Datensätze mit Titel',
    query: `PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dct:  <http://purl.org/dc/terms/>
SELECT ?dataset ?title WHERE {
  GRAPH ?g { ?dataset a dcat:Dataset ; dct:title ?title }
}`,
  },
  {
    name: sampleCatalogTitle.value
      ? `Datensätze aus „${sampleCatalogTitle.value}“`
      : 'Datensätze eines Katalogs',
    query: `PREFIX dcat: <http://www.w3.org/ns/dcat#>
# Der Graphname ist die Lese-URL des Katalogs.
SELECT ?dataset WHERE {
  GRAPH <${sampleCatalog.value}> { ?c dcat:dataset ?dataset }
}`,
  },
  {
    name: 'Verteilungen nach Format',
    query: `PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dct:  <http://purl.org/dc/terms/>
# COUNT(DISTINCT ?d), nicht COUNT(?d): eine Distribution ist Containment und
# erscheint in zwei Graphen — ihrem eigenen und dem ihres Datensatzes. Ohne
# DISTINCT zählt man Graph-Vorkommen statt Distributionen.
SELECT ?format (COUNT(DISTINCT ?d) AS ?anzahl) WHERE {
  GRAPH ?g { ?d a dcat:Distribution ; dct:format ?format }
}
GROUP BY ?format ORDER BY DESC(?anzahl)`,
  },
  {
    name: 'Eine Ressource als RDF',
    query: `CONSTRUCT { ?s ?p ?o } WHERE {
  GRAPH <${sampleCatalog.value}> { ?s ?p ?o }
}`,
  },
]);

const query = ref(EXAMPLES.value[1].query);
const result = shallowRef<SparqlResult | null>(null);
const error = ref('');
const running = ref(false);
const elapsed = ref(0);

async function run() {
  const api = props.client;
  if (!api || running.value) return;
  running.value = true;
  error.value = '';
  result.value = null;
  const started = performance.now();
  try {
    result.value = await api.sparql(query.value);
  } catch (err) {
    error.value = err instanceof DcatAtlasError ? err.message : String(err);
  } finally {
    elapsed.value = Math.round(performance.now() - started);
    running.value = false;
  }
}

function useExample(q: string) {
  query.value = q;
  result.value = null;
  error.value = '';
}

/** Anzeigetext einer Zelle; ein Literal mit Sprache bekommt sie angehängt. */
function cellText(cell: SparqlCell | undefined): string {
  if (!cell) return '';
  const lang = cell['xml:lang'];
  return lang ? `${cell.value} (${lang})` : cell.value;
}

/** IRIs des Portals sind dereferenzierbar — als Link ausgeben. */
function cellHref(cell: SparqlCell | undefined): string {
  return cell?.type === 'uri' && /^https?:/.test(cell.value) ? cell.value : '';
}

const rowCount = computed(() =>
  result.value?.kind === 'table' ? result.value.rows.length : 0
);
</script>

<template>
  <div class="sparql">
    <p class="sparql__intro">
      Fragt den gesamten Katalog auf einmal ab — das, was Content-Negotiation
      auf einer einzelnen Ressource nicht kann. Der Endpunkt ist
      <strong>nur lesend</strong>: er parst die Abfrage, ein <code>UPDATE</code>
      scheitert daher schon an der Syntaxprüfung.
    </p>

    <div class="sparql__examples">
      <button
        v-for="ex in EXAMPLES"
        :key="ex.name"
        type="button"
        class="sparql__example"
        @click="useExample(ex.query)"
      >{{ ex.name }}</button>
    </div>

    <textarea
      v-model="query"
      class="sparql__input"
      spellcheck="false"
      rows="10"
      aria-label="SPARQL-Abfrage"
      @keydown.ctrl.enter.prevent="run()"
      @keydown.meta.enter.prevent="run()"
    ></textarea>

    <div class="sparql__actions">
      <button type="button" class="sparql__run" :disabled="running || !client" @click="run()">
        {{ running ? 'Läuft…' : 'Abfrage ausführen' }}
      </button>
      <span class="sparql__hint">Strg+Enter</span>
      <span v-if="result || error" class="sparql__hint">{{ elapsed }} ms</span>
    </div>

    <!--
      Der Default-Graph ist leer: jede Ressource liegt in ihrem eigenen
      benannten Graphen. Eine Abfrage ohne GRAPH trifft deshalb garantiert
      nichts — das ist die häufigste Stolperfalle und verdient einen Hinweis
      statt einer rätselhaften Null.
    -->
    <p v-if="!/\bGRAPH\b/i.test(query)" class="sparql__warning">
      Die Abfrage nennt kein <code>GRAPH</code>. Jede Ressource liegt in einem
      eigenen benannten Graphen und der Default-Graph ist leer — ohne
      <code>GRAPH ?g { … }</code> bleibt das Ergebnis leer.
    </p>

    <p v-if="error" class="sparql__error">{{ error }}</p>

    <template v-if="result">
      <!-- SELECT -->
      <template v-if="result.kind === 'table'">
        <p class="sparql__meta">
          {{ rowCount }} {{ rowCount === 1 ? 'Zeile' : 'Zeilen' }}
          <span v-if="rowCount >= 10000"> — die Obergrenze von 10.000 ist erreicht, das Ergebnis ist beschnitten.</span>
        </p>
        <div v-if="rowCount" class="sparql__tablewrap">
          <table class="sparql__table">
            <thead>
              <tr><th v-for="v in result.vars" :key="v">{{ v }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in result.rows" :key="i">
                <td v-for="v in result.vars" :key="v">
                  <a
                    v-if="cellHref(row[v])"
                    :href="cellHref(row[v])"
                    target="_blank"
                    rel="noopener"
                  >{{ cellText(row[v]) }}</a>
                  <span v-else>{{ cellText(row[v]) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ASK -->
      <p v-else-if="result.kind === 'boolean'" class="sparql__boolean">
        {{ result.value ? 'Ja — es gibt einen Treffer.' : 'Nein — kein Treffer.' }}
      </p>

      <!-- CONSTRUCT / DESCRIBE -->
      <template v-else>
        <p class="sparql__meta">Graph als <code>{{ result.contentType }}</code></p>
        <pre class="sparql__graph">{{ result.text }}</pre>
      </template>
    </template>
  </div>
</template>
