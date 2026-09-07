<script setup lang="ts">
import type { EObject } from '@emfts/core';
import { computed } from 'vue';
import {
  eget,
  asList,
  getLabel,
  getPreferredLabels,
  formatDate,
} from '../emf/eObjectUtils';
import { themeLabel, formatLabel } from '../emf/vocab';

const props = defineProps<{
  dataset: EObject;
  active?: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const title = computed(() => getLabel(props.dataset, 'title'));
const description = computed(() => {
  const desc = getLabel(props.dataset, 'description');
  return desc.length > 200 ? desc.slice(0, 200) + '…' : desc;
});

const publisher = computed(() => getLabel(eget(props.dataset, 'publisher'), 'name'));

// `theme` ist im Modell des Servers ein IRI, kein eingebettetes SKOS-Concept.
const themes = computed(() =>
  asList(eget(props.dataset, 'theme')).map((t) => themeLabel(String(t))).filter(Boolean)
);

// Schlagwörter, die schon als Kategorie danebenstehen, weglassen: auf der
// Karte sind die beiden Reihen unbeschriftet, ein doppeltes „Umwelt“ liest
// sich dort wie ein Fehler. In der Detailansicht sind sie beschriftet und
// bleiben darum vollständig.
const keywords = computed(() => {
  const shown = new Set(themes.value.map((t) => t.toLowerCase()));
  return getPreferredLabels(props.dataset, 'keyword')
    .filter((kw) => !shown.has(kw.toLowerCase()))
    .slice(0, 6);
});

const formats = computed(() => {
  const seen = new Set<string>();
  for (const d of asList(eget(props.dataset, 'distribution'))) {
    const label = formatLabel(eget(d, 'format')) || formatLabel(eget(d, 'mediaType'));
    if (label) seen.add(label);
  }
  return Array.from(seen);
});

const modified = computed(() => formatDate(getLabel(props.dataset, 'modified')));
</script>

<template>
  <!--
    Die ganze Karte ist mit der Maus anklickbar, das Bedienelement für Tastatur
    und Screenreader ist aber der Titel. Ein `role="button"` auf der Karte wäre
    einfacher, macht ihren Inhalt aber zu Beiwerk: Beschreibung, Kategorien und
    Schlagwörter wären dann nicht mehr einzeln vorlesbar.
  -->
  <article
    class="dataset-card"
    :class="{ 'dataset-card--active': active }"
    @click="emit('select')"
  >
    <div class="dataset-card__header">
      <h3 class="dataset-card__title">
        <button type="button" class="dataset-card__open" @click.stop="emit('select')">
          {{ title || 'Ohne Titel' }}
        </button>
      </h3>
      <span v-if="publisher" class="dataset-card__publisher">{{ publisher }}</span>
    </div>

    <p class="dataset-card__desc">{{ description }}</p>

    <div class="dataset-card__meta">
      <div v-if="themes.length" class="dataset-card__themes">
        <span v-for="theme in themes" :key="theme" class="tag tag--theme">{{ theme }}</span>
      </div>
      <div v-if="keywords.length" class="dataset-card__keywords">
        <span v-for="kw in keywords" :key="kw" class="tag tag--keyword">{{ kw }}</span>
      </div>
    </div>

    <div class="dataset-card__footer">
      <div v-if="formats.length" class="dataset-card__formats">
        <span v-for="fmt in formats" :key="fmt" class="format-badge">{{ fmt }}</span>
      </div>
      <span v-if="modified" class="dataset-card__date">{{ modified }}</span>
    </div>
  </article>
</template>
