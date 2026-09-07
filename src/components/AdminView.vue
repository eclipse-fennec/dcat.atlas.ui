<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { EObject } from '@emfts/core';
import { DcatAtlasError, idOf } from '../api/dcatAtlas';
import type { DcatAtlasClient, DcatCollection, ValidatableCollection } from '../api/dcatAtlas';
import { buildXmi } from '../api/xmiBuilder';
import type { XmiPart } from '../api/xmiBuilder';
import { getAbout, getLabel } from '../emf/eObjectUtils';
import {
  THEME_OPTIONS,
  FREQUENCY_OPTIONS,
  LANGUAGE_OPTIONS,
  LICENSE_OPTIONS,
  FILE_TYPE_OPTIONS,
} from '../emf/vocab';

const props = defineProps<{
  client: DcatAtlasClient | null;
  catalogs: EObject[];
  datasets: EObject[];
}>();

const emit = defineEmits<{
  /** Nach erfolgreichem Anlegen: die Listen im Portal neu holen. */
  created: [];
}>();

type Kind = 'catalogs' | 'datasets' | 'distributions';
const kind = ref<Kind>('catalogs');

const KIND_LABELS: Record<Kind, string> = {
  catalogs: 'Katalog',
  datasets: 'Datensatz',
  distributions: 'Distribution',
};

/**
 * Die host-freie Form. Der Server akzeptiert `about` unter seiner öffentlichen
 * Basis **oder** unter dieser logischen — letztere macht das Formular
 * unabhängig davon, unter welcher Adresse das Portal gerade läuft.
 */
const LOGICAL_BASE = 'http://dcat.atlas';

const form = reactive({
  id: '',
  titleDe: '',
  titleEn: '',
  description: '',
  publisherName: '',
  publisherIri: '',
  homepage: '',
  language: LANGUAGE_OPTIONS.find((l) => l.iri.endsWith('/DEU'))?.iri ?? '',
  license: '',
  keywords: '',
  themes: [] as string[],
  frequency: '',
  contactName: '',
  contactEmail: '',
  /** Nur für Datensätze: nach dem Anlegen in diesen Katalog hängen. */
  intoCatalog: '',
  /** Nur für Distributionen. */
  parentDataset: '',
  format: '',
  mediaType: '',
  accessURL: '',
  downloadURL: '',
  byteSize: '',
});

const catalogOptions = computed(() =>
  props.catalogs
    .map((cat) => ({ id: idOf(getAbout(cat)), title: getLabel(cat, 'title') || idOf(getAbout(cat)) }))
    .filter((c) => c.id)
);

const datasetOptions = computed(() =>
  props.datasets
    .map((ds) => ({ id: idOf(getAbout(ds)), title: getLabel(ds, 'title') || idOf(getAbout(ds)) }))
    .filter((d) => d.id)
);

/**
 * Format und Medientyp beschreiben dasselbe in zwei Registern. Die Auswahl
 * belegt den Medientyp vor, überschreibt aber keine Eingabe von Hand.
 */
watch(
  () => form.format,
  (iri, previous) => {
    const chosen = FILE_TYPE_OPTIONS.find((f) => f.iri === iri);
    const previousDefault = FILE_TYPE_OPTIONS.find((f) => f.iri === previous)?.mediaType;
    if (chosen && (!form.mediaType.trim() || form.mediaType === previousDefault)) {
      form.mediaType = chosen.mediaType;
    }
  }
);

/**
 * Was das Modell zwingend verlangt.
 *
 * Katalog und Datensatz: Titel, Beschreibung, Herausgeber.
 * Distribution: der Datensatz, in den sie gehört, plus `accessURL` und
 * `license` — beide sind im Modell `lowerBound="1"`.
 */
const missing = computed(() => {
  const gaps: string[] = [];
  if (kind.value === 'distributions') {
    if (!form.parentDataset) gaps.push('Datensatz');
    if (!form.accessURL.trim()) gaps.push('Zugriffs-URL');
    if (!form.license) gaps.push('Lizenz');
  } else {
    if (!form.titleDe.trim()) gaps.push('Titel');
    if (!form.description.trim()) gaps.push('Beschreibung');
    if (!form.publisherName.trim()) gaps.push('Herausgeber');
  }
  return gaps;
});

/**
 * Die Identität. Eine Distribution nistet im Pfad ihres Datensatzes — sie hat
 * keine eigene Collection.
 */
const about = computed(() => {
  const id = form.id.trim();
  if (kind.value === 'distributions') {
    if (!form.parentDataset || !id) return undefined;
    return `${LOGICAL_BASE}/datasets/${form.parentDataset}/distributions/${id}`;
  }
  return id ? `${LOGICAL_BASE}/${kind.value}/${id}` : undefined;
});

/** Kommagetrennte Eingabe zu Einzelwerten, leere weg. */
const splitList = (raw: string) => raw.split(',').map((s) => s.trim()).filter(Boolean);

const xmi = computed(() => {
  const parts: XmiPart[] = [];

  if (kind.value === 'distributions') {
    // Titel und Beschreibung sind hier **einwertig** — anders als bei Katalog
    // und Datensatz, wo das Modell mehrere Sprachen zulässt.
    if (form.titleDe.trim()) {
      parts.push({ kind: 'literal', name: 'title', values: [{ value: form.titleDe, lang: 'de' }] });
    }
    if (form.description.trim()) {
      parts.push({
        kind: 'literal',
        name: 'description',
        values: [{ value: form.description, lang: 'de' }],
      });
    }
    if (form.format) parts.push({ kind: 'attr', name: 'format', value: form.format });
    if (form.mediaType.trim()) parts.push({ kind: 'attr', name: 'mediaType', value: form.mediaType });
    if (form.byteSize.trim()) parts.push({ kind: 'attr', name: 'byteSize', value: form.byteSize });
    if (form.license) parts.push({ kind: 'object', name: 'license', about: form.license, parts: [] });
    parts.push({ kind: 'iri', name: 'accessURL', values: splitList(form.accessURL) });
    if (form.downloadURL.trim()) {
      parts.push({ kind: 'iri', name: 'downloadURL', values: splitList(form.downloadURL) });
    }
    return buildXmi('Distribution', about.value, parts);
  }

  const titles = [
    { value: form.titleDe, lang: 'de' },
    ...(form.titleEn.trim() ? [{ value: form.titleEn, lang: 'en' }] : []),
  ];
  parts.push({ kind: 'literal', name: 'title', values: titles });
  parts.push({
    kind: 'literal',
    name: 'description',
    values: [{ value: form.description, lang: 'de' }],
  });

  if (kind.value === 'datasets') {
    if (form.keywords.trim()) {
      parts.push({
        kind: 'literal',
        name: 'keyword',
        values: splitList(form.keywords).map((value) => ({ value, lang: 'de' })),
      });
    }
    if (form.themes.length) parts.push({ kind: 'iri', name: 'theme', values: form.themes });
    // Einwertig und URI-wertig -> als Attribut am Wurzelelement erlaubt.
    if (form.frequency) parts.push({ kind: 'attr', name: 'accrualPeriodicity', value: form.frequency });
  } else if (form.homepage.trim()) {
    parts.push({ kind: 'attr', name: 'homepage', value: form.homepage });
  }

  if (form.language) parts.push({ kind: 'iri', name: 'language', values: [form.language] });

  parts.push({
    kind: 'object',
    name: 'publisher',
    about: form.publisherIri.trim() || undefined,
    parts: [{ kind: 'literal', name: 'name', values: [{ value: form.publisherName, lang: 'de' }] }],
  });

  if (kind.value === 'datasets' && (form.contactName.trim() || form.contactEmail.trim())) {
    parts.push({
      kind: 'object',
      name: 'contactPoint',
      parts: [
        ...(form.contactName.trim()
          ? ([{ kind: 'text', name: 'fn', values: [form.contactName] }] as XmiPart[])
          : []),
        ...(form.contactEmail.trim()
          ? ([{
              kind: 'iri',
              name: 'hasEmail',
              // vcard:hasEmail muss ein mailto:-IRI sein, sonst greift eine
              // Modellconstraint — der Präfix wird ergänzt, nicht eingefordert.
              values: [
                form.contactEmail.startsWith('mailto:')
                  ? form.contactEmail
                  : `mailto:${form.contactEmail}`,
              ],
            }] as XmiPart[])
          : []),
      ],
    });
  }

  if (form.license) parts.push({ kind: 'object', name: 'license', about: form.license, parts: [] });

  return buildXmi(kind.value === 'catalogs' ? 'Catalog' : 'Dataset', about.value, parts);
});

// ------------------------------------------------------------------- Aktionen

const busy = ref<'' | 'check' | 'save'>('');
const message = ref('');
const messageKind = ref<'ok' | 'warn' | 'error'>('ok');
const showXmi = ref(false);

function report(text: string, level: 'ok' | 'warn' | 'error') {
  message.value = text;
  messageKind.value = level;
}

async function check() {
  const api = props.client;
  if (!api || busy.value) return;
  busy.value = 'check';
  message.value = '';
  try {
    const outcome = await api.validate(kind.value as ValidatableCollection, xmi.value);
    if (outcome.conforms) {
      report(
        'Die Validierung ist konform. Hinweis: ohne konfigurierte SHACL-Shapes meldet der Server Konformität, weil er nichts zu vergleichen hat — das ist keine Zusicherung.',
        'ok'
      );
    } else {
      report(`Die Profilvalidierung bemängelt etwas:\n\n${outcome.report.slice(0, 1500)}`, 'warn');
    }
  } catch (err) {
    report(err instanceof DcatAtlasError ? err.message : String(err), 'error');
  } finally {
    busy.value = '';
  }
}

async function save() {
  const api = props.client;
  if (!api || busy.value) return;
  if (missing.value.length) {
    report(`Es fehlen Pflichtangaben: ${missing.value.join(', ')}.`, 'warn');
    return;
  }
  busy.value = 'save';
  message.value = '';
  try {
    const created =
      kind.value === 'distributions'
        ? await api.createDistribution(form.parentDataset, xmi.value)
        : await api.create(kind.value as DcatCollection, xmi.value);

    let extra = '';
    if (kind.value === 'datasets' && form.intoCatalog) {
      try {
        await api.linkDatasetToCatalog(form.intoCatalog, created.id);
        extra = ` und in den Katalog „${
          catalogOptions.value.find((c) => c.id === form.intoCatalog)?.title ?? form.intoCatalog
        }“ gehängt`;
      } catch (err) {
        extra = ` — angelegt, aber das Einhängen in den Katalog schlug fehl: ${
          err instanceof DcatAtlasError ? err.message : String(err)
        }`;
      }
    }
    report(`${KIND_LABELS[kind.value]} angelegt${extra}. Id: ${created.id}\n${created.location}`, 'ok');
    resetContent();
    emit('created');
  } catch (err) {
    report(err instanceof DcatAtlasError ? err.message : String(err), 'error');
  } finally {
    busy.value = '';
  }
}

/** Nach dem Anlegen die Inhalte leeren; Herausgeber und Lizenz behalten. */
function resetContent() {
  form.id = '';
  form.titleDe = '';
  form.titleEn = '';
  form.description = '';
  form.keywords = '';
  form.themes = [];
  form.contactName = '';
  form.contactEmail = '';
  form.accessURL = '';
  form.downloadURL = '';
  form.byteSize = '';
}

function switchKind(next: Kind) {
  kind.value = next;
  message.value = '';
}
</script>

<template>
  <div class="admin">
    <p class="admin__intro">
      Legt Kataloge, Datensätze und Distributionen über die Admin-API an.
      Geschrieben wird <code>application/xmi</code> — das ist das einzige
      Format, das die Schreibseite annimmt. Was genau rausgeht, steht unten im
      Vorschaufeld.
    </p>

    <div class="admin__kinds">
      <button
        v-for="k in (['catalogs', 'datasets', 'distributions'] as Kind[])"
        :key="k"
        type="button"
        :class="['admin__kind', { 'admin__kind--active': kind === k }]"
        @click="switchKind(k)"
      >{{ KIND_LABELS[k] }}</button>
    </div>

    <form class="admin__form" @submit.prevent="save()">
      <!-- ============================== Distribution ============================== -->
      <template v-if="kind === 'distributions'">
        <p class="admin__note">
          Eine Distribution hat keine eigene Collection — sie ist Containment
          im Datensatz und wird in dessen Kontext angelegt.
        </p>
        <div class="admin__grid">
          <label class="field2">
            <span class="field2__label">Datensatz <em>Pflicht</em></span>
            <select v-model="form.parentDataset" class="field2__input" required>
              <option value="">— bitte wählen —</option>
              <option v-for="d in datasetOptions" :key="d.id" :value="d.id">{{ d.title }}</option>
            </select>
          </label>
          <label class="field2">
            <span class="field2__label">Titel</span>
            <input v-model="form.titleDe" class="field2__input" />
          </label>

          <label class="field2 field2--wide">
            <span class="field2__label">Beschreibung</span>
            <textarea v-model="form.description" class="field2__input" rows="2"></textarea>
          </label>

          <label class="field2">
            <span class="field2__label">Format</span>
            <select v-model="form.format" class="field2__input">
              <option value="">— keine Angabe —</option>
              <option v-for="f in FILE_TYPE_OPTIONS" :key="f.iri" :value="f.iri">{{ f.label }}</option>
            </select>
          </label>
          <label class="field2">
            <span class="field2__label">Medientyp</span>
            <input v-model="form.mediaType" class="field2__input" placeholder="wird aus dem Format vorbelegt" />
          </label>
          <label class="field2">
            <span class="field2__label">Größe in Byte</span>
            <input v-model="form.byteSize" class="field2__input" inputmode="numeric" placeholder="z. B. 204800" />
          </label>

          <label class="field2 field2--wide">
            <span class="field2__label">Zugriffs-URL <em>Pflicht</em></span>
            <input v-model="form.accessURL" class="field2__input" placeholder="https://… — mehrere durch Komma" required />
          </label>
          <label class="field2 field2--wide">
            <span class="field2__label">Download-URL</span>
            <input v-model="form.downloadURL" class="field2__input" placeholder="https://… — mehrere durch Komma" />
          </label>

          <label class="field2">
            <span class="field2__label">Lizenz <em>Pflicht</em></span>
            <select v-model="form.license" class="field2__input" required>
              <option value="">— bitte wählen —</option>
              <option v-for="l in LICENSE_OPTIONS" :key="l.iri" :value="l.iri">{{ l.label }}</option>
            </select>
          </label>
          <label class="field2">
            <span class="field2__label">Id</span>
            <input v-model="form.id" class="field2__input" placeholder="leer lassen — Server vergibt eine" />
          </label>
        </div>
      </template>

      <!-- ========================= Katalog und Datensatz ========================= -->
      <div v-else class="admin__grid">
        <label class="field2">
          <span class="field2__label">Titel (deutsch) <em>Pflicht</em></span>
          <input v-model="form.titleDe" class="field2__input" required />
        </label>
        <label class="field2">
          <span class="field2__label">Titel (englisch)</span>
          <input v-model="form.titleEn" class="field2__input" />
        </label>

        <label class="field2 field2--wide">
          <span class="field2__label">Beschreibung <em>Pflicht</em></span>
          <textarea v-model="form.description" class="field2__input" rows="3" required></textarea>
        </label>

        <label class="field2">
          <span class="field2__label">Herausgeber <em>Pflicht</em></span>
          <input v-model="form.publisherName" class="field2__input" placeholder="Name der Stelle" required />
        </label>
        <label class="field2">
          <span class="field2__label">Herausgeber-IRI</span>
          <input v-model="form.publisherIri" class="field2__input" placeholder="https://…" />
        </label>

        <label v-if="kind === 'catalogs'" class="field2">
          <span class="field2__label">Homepage</span>
          <input v-model="form.homepage" class="field2__input" placeholder="https://…" />
        </label>

        <template v-if="kind === 'datasets'">
          <label class="field2">
            <span class="field2__label">Schlagwörter</span>
            <input v-model="form.keywords" class="field2__input" placeholder="durch Komma getrennt" />
          </label>
          <label class="field2">
            <span class="field2__label">Aktualisierung</span>
            <select v-model="form.frequency" class="field2__input">
              <option value="">— keine Angabe —</option>
              <option v-for="f in FREQUENCY_OPTIONS" :key="f.iri" :value="f.iri">{{ f.label }}</option>
            </select>
          </label>
          <fieldset class="field2 field2--wide admin__themes">
            <legend class="field2__label">Kategorien</legend>
            <label v-for="t in THEME_OPTIONS" :key="t.iri" class="admin__theme">
              <input type="checkbox" :value="t.iri" v-model="form.themes" />
              <span>{{ t.label }}</span>
            </label>
          </fieldset>
          <label class="field2">
            <span class="field2__label">Kontakt: Name</span>
            <input v-model="form.contactName" class="field2__input" />
          </label>
          <label class="field2">
            <span class="field2__label">Kontakt: E-Mail</span>
            <input v-model="form.contactEmail" class="field2__input" placeholder="team@example.org" />
          </label>
        </template>

        <label class="field2">
          <span class="field2__label">Sprache</span>
          <select v-model="form.language" class="field2__input">
            <option value="">— keine Angabe —</option>
            <option v-for="l in LANGUAGE_OPTIONS" :key="l.iri" :value="l.iri">{{ l.label }}</option>
          </select>
        </label>
        <label class="field2">
          <span class="field2__label">Lizenz</span>
          <select v-model="form.license" class="field2__input">
            <option value="">— keine Angabe —</option>
            <option v-for="l in LICENSE_OPTIONS" :key="l.iri" :value="l.iri">{{ l.label }}</option>
          </select>
        </label>

        <label class="field2">
          <span class="field2__label">Id</span>
          <input v-model="form.id" class="field2__input" placeholder="leer lassen — Server vergibt eine" />
        </label>
        <label v-if="kind === 'datasets' && catalogOptions.length" class="field2">
          <span class="field2__label">In Katalog einhängen</span>
          <select v-model="form.intoCatalog" class="field2__input">
            <option value="">— nicht einhängen —</option>
            <option v-for="c in catalogOptions" :key="c.id" :value="c.id">{{ c.title }}</option>
          </select>
        </label>
      </div>

      <p v-if="missing.length" class="admin__missing">
        Noch offen: {{ missing.join(', ') }}.
        <template v-if="kind === 'distributions'">
          Das Modell verlangt für eine Distribution mindestens eine Zugriffs-URL
          und eine Lizenz.
        </template>
        <template v-else>
          Das Modell verlangt Titel, Beschreibung und Herausgeber — ohne sie
          lehnt der Server mit 422 ab.
        </template>
      </p>

      <div class="admin__actions">
        <button type="button" class="admin__check" :disabled="!!busy || !client" @click="check()">
          {{ busy === 'check' ? 'Prüft…' : 'Prüfen (ohne zu speichern)' }}
        </button>
        <button type="submit" class="admin__save" :disabled="!!busy || !client || missing.length > 0">
          {{ busy === 'save' ? 'Legt an…' : `${KIND_LABELS[kind]} anlegen` }}
        </button>
        <button type="button" class="admin__toggle" @click="showXmi = !showXmi">
          {{ showXmi ? 'Vorschau ausblenden' : 'Vorschau der Nutzdaten' }}
        </button>
      </div>
    </form>

    <p v-if="message" :class="['admin__message', `admin__message--${messageKind}`]">{{ message }}</p>

    <template v-if="showXmi">
      <p class="admin__meta">
        Genau dieser Rumpf geht als <code>application/xmi</code> raus.
      </p>
      <pre class="admin__xmi">{{ xmi }}</pre>
    </template>
  </div>
</template>
