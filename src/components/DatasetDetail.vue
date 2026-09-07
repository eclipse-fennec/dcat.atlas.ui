<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EObject } from '@emfts/core';
import {
  eget,
  asList,
  getLabel,
  getAllLabels,
  getPreferredLabels,
  getAbout,
  formatBytes,
  formatDate,
} from '../emf/eObjectUtils';
import { themeLabel, frequencyLabel, languageLabel, formatLabel, licenseLabel, iriLabel } from '../emf/vocab';
import { idOf } from '../api/dcatAtlas';
import type { DcatAtlasClient } from '../api/dcatAtlas';

const props = defineProps<{
  dataset: EObject;
  /** Optional: lädt Distributions nach, falls sie nicht eingebettet sind. */
  client?: DcatAtlasClient | null;
}>();

const title = computed(() => getLabel(props.dataset, 'title'));
const description = computed(() => getLabel(props.dataset, 'description'));
const about = computed(() => getAbout(props.dataset));

const publisher = computed(() => getLabel(eget(props.dataset, 'publisher'), 'name'));
const creator = computed(() => getLabel(eget(props.dataset, 'creator'), 'name'));

const contactPoint = computed(() => {
  const contacts = asList(eget(props.dataset, 'contactPoint'));
  if (contacts.length === 0) return null;
  const cp = contacts[0];
  return {
    name: getLabel(cp, 'fn') || getLabel(cp, 'organizationName'),
    email: getLabel(cp, 'hasEmail'),
    phone: getLabel(cp, 'hasTelephone'),
  };
});

const themes = computed(() =>
  asList(eget(props.dataset, 'theme')).map((t) => themeLabel(String(t))).filter(Boolean)
);
const keywords = computed(() => getPreferredLabels(props.dataset, 'keyword'));
const languages = computed(() =>
  asList(eget(props.dataset, 'language')).map((l) => languageLabel(String(l))).filter(Boolean)
);
const identifiers = computed(() => getAllLabels(props.dataset, 'identifier'));

const issued = computed(() => formatDate(getLabel(props.dataset, 'issued')));
const modified = computed(() => formatDate(getLabel(props.dataset, 'modified')));
const accrualPeriodicity = computed(() => frequencyLabel(eget(props.dataset, 'accrualPeriodicity')));

const spatial = computed(() =>
  asList(eget(props.dataset, 'spatial')).map((s) => getLabel(s, 'prefLabel')).filter(Boolean)
);

const temporal = computed(() =>
  asList(eget(props.dataset, 'temporal'))
    .map((p) => {
      const start = formatDate(getLabel(p, 'startDate'));
      const end = formatDate(getLabel(p, 'endDate'));
      if (start && end) return `${start} – ${end}`;
      if (start) return `ab ${start}`;
      if (end) return `bis ${end}`;
      return '';
    })
    .filter(Boolean)
);

const accessRights = computed(() => iriLabel(eget(props.dataset, 'accessRights')));

/** Lizenz: bevorzugt der Titel des LicenseDocument, sonst dessen IRI. */
function licenseOf(owner: EObject | undefined | null) {
  const lic = eget(owner, 'license');
  if (!lic) return { label: '', href: '' };
  const href = getAbout(lic);
  return { label: getLabel(lic, 'title') || licenseLabel(href), href };
}
const license = computed(() => licenseOf(props.dataset));

const landingPages = computed(() =>
  asList(eget(props.dataset, 'landingPage')).map(getAbout).filter(Boolean)
);

/**
 * Distributions sind Containment und stehen daher schon im XMI des Datasets.
 * Liefert eine Antwort sie ausnahmsweise nicht mit, holt der eigene Endpunkt
 * `GET /datasets/{id}/distributions` sie nach.
 */
const fetched = ref<EObject[]>([]);
const loadingDists = ref(false);

watch(
  () => props.dataset,
  async (ds) => {
    fetched.value = [];
    if (!props.client || asList(eget(ds, 'distribution')).length > 0) return;
    const id = idOf(getAbout(ds));
    if (!id) return;
    loadingDists.value = true;
    try {
      fetched.value = await props.client.distributions(id);
    } catch (err) {
      console.warn('Distributions konnten nicht geladen werden:', err);
    } finally {
      loadingDists.value = false;
    }
  },
  { immediate: true }
);

const distributions = computed(() => {
  const embedded = asList(eget(props.dataset, 'distribution'));
  const source = embedded.length > 0 ? embedded : fetched.value;
  return source.map((d) => ({
    title: getLabel(d, 'title'),
    description: getLabel(d, 'description'),
    format: formatLabel(eget(d, 'format')) || formatLabel(eget(d, 'mediaType')),
    mediaType: getLabel(d, 'mediaType'),
    accessURLs: asList(eget(d, 'accessURL')).map(String).filter(Boolean),
    downloadURLs: asList(eget(d, 'downloadURL')).map(String).filter(Boolean),
    byteSize: formatBytes(getLabel(d, 'byteSize')),
    license: licenseOf(d),
  }));
});
</script>

<template>
  <div class="detail">
    <!-- Header -->
    <header class="detail__header">
      <h2 class="detail__title">{{ title || 'Ohne Titel' }}</h2>
      <div class="detail__publisher" v-if="publisher">
        <span class="detail__byline">Herausgeber:</span> {{ publisher }}
      </div>
      <a v-if="about" :href="about" target="_blank" rel="noopener" class="detail__iri">{{ about }}</a>
    </header>

    <!-- Beschreibung -->
    <section class="detail__section">
      <p class="detail__description">{{ description }}</p>
      <div v-if="landingPages.length" class="detail__field">
        <span class="detail__label">Webseite</span>
        <div>
          <a v-for="lp in landingPages" :key="lp" :href="lp" target="_blank" rel="noopener">{{ lp }}</a>
        </div>
      </div>
    </section>

    <!-- Klassifikation -->
    <section class="detail__section" v-if="themes.length || keywords.length">
      <h3 class="detail__section-title">Klassifikation</h3>
      <div v-if="themes.length" class="detail__field">
        <span class="detail__label">Kategorien</span>
        <div class="detail__tags">
          <span v-for="t in themes" :key="t" class="tag tag--theme">{{ t }}</span>
        </div>
      </div>
      <div v-if="keywords.length" class="detail__field">
        <span class="detail__label">Schlagwörter</span>
        <div class="detail__tags">
          <span v-for="kw in keywords" :key="kw" class="tag tag--keyword">{{ kw }}</span>
        </div>
      </div>
    </section>

    <!-- Zeitlich & Räumlich -->
    <section class="detail__section">
      <h3 class="detail__section-title">Zeitlich &amp; Räumlich</h3>
      <dl class="detail__dl">
        <template v-if="issued"><dt>Veröffentlicht</dt><dd>{{ issued }}</dd></template>
        <template v-if="modified"><dt>Zuletzt geändert</dt><dd>{{ modified }}</dd></template>
        <template v-if="accrualPeriodicity"><dt>Aktualisierung</dt><dd>{{ accrualPeriodicity }}</dd></template>
        <template v-for="s in spatial" :key="s"><dt>Räumlich</dt><dd>{{ s }}</dd></template>
        <template v-for="t in temporal" :key="t"><dt>Zeitraum</dt><dd>{{ t }}</dd></template>
        <template v-if="languages.length"><dt>Sprache</dt><dd>{{ languages.join(', ') }}</dd></template>
      </dl>
    </section>

    <!-- Zugang & Rechte -->
    <section class="detail__section" v-if="accessRights || license.label || creator || identifiers.length">
      <h3 class="detail__section-title">Zugang &amp; Rechte</h3>
      <dl class="detail__dl">
        <template v-if="accessRights"><dt>Zugriffsrechte</dt><dd>{{ accessRights }}</dd></template>
        <template v-if="license.label">
          <dt>Lizenz</dt>
          <dd>
            <a v-if="license.href" :href="license.href" target="_blank" rel="noopener">{{ license.label }}</a>
            <span v-else>{{ license.label }}</span>
          </dd>
        </template>
        <template v-if="creator"><dt>Ersteller</dt><dd>{{ creator }}</dd></template>
        <template v-for="id in identifiers" :key="id"><dt>Identifier</dt><dd>{{ id }}</dd></template>
      </dl>
    </section>

    <!-- Kontakt -->
    <section class="detail__section" v-if="contactPoint">
      <h3 class="detail__section-title">Kontakt</h3>
      <dl class="detail__dl">
        <template v-if="contactPoint.name"><dt>Name</dt><dd>{{ contactPoint.name }}</dd></template>
        <template v-if="contactPoint.email">
          <dt>E-Mail</dt>
          <dd><a :href="contactPoint.email">{{ contactPoint.email.replace('mailto:', '') }}</a></dd>
        </template>
        <template v-if="contactPoint.phone">
          <dt>Telefon</dt>
          <dd>{{ contactPoint.phone.replace('tel:', '') }}</dd>
        </template>
      </dl>
    </section>

    <!-- Distributionen -->
    <section class="detail__section" v-if="distributions.length || loadingDists">
      <h3 class="detail__section-title">Distributionen</h3>
      <p v-if="loadingDists" class="detail__hint">Distributionen werden geladen…</p>
      <div class="dist-list">
        <article v-for="(dist, i) in distributions" :key="i" class="dist-card">
          <div class="dist-card__header">
            <span v-if="dist.format" class="format-badge format-badge--lg">{{ dist.format }}</span>
            <h4 class="dist-card__title">{{ dist.title || dist.format || 'Distribution' }}</h4>
          </div>
          <p v-if="dist.description" class="dist-card__desc">{{ dist.description }}</p>
          <dl class="dist-card__dl">
            <template v-if="dist.mediaType"><dt>Medientyp</dt><dd>{{ dist.mediaType }}</dd></template>
            <template v-if="dist.byteSize"><dt>Größe</dt><dd>{{ dist.byteSize }}</dd></template>
            <template v-if="dist.license.label"><dt>Lizenz</dt><dd>{{ dist.license.label }}</dd></template>
          </dl>
          <div class="dist-card__links">
            <a
              v-for="url in dist.accessURLs"
              :key="url"
              :href="url"
              target="_blank"
              rel="noopener"
              class="dist-link"
            >Zugang</a>
            <a
              v-for="url in dist.downloadURLs"
              :key="url"
              :href="url"
              target="_blank"
              rel="noopener"
              class="dist-link dist-link--download"
            >Download</a>
          </div>
        </article>
      </div>
    </section>

    <!-- Verweis auf die Portal-Darstellung -->
    <section class="detail__section" v-if="about">
      <h3 class="detail__section-title">Metadaten</h3>
      <a :href="about" target="_blank" rel="noopener" class="dist-link">Im Portal öffnen</a>
      <p class="detail__hint detail__hint--after">
        Dort auch maschinenlesbar als Turtle, JSON-LD, RDF/XML, N-Triples oder XMI.
      </p>
    </section>

  </div>
</template>
