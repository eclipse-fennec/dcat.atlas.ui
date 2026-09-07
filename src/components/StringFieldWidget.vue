<script setup lang="ts">
import { computed } from 'vue';
import type { EObject, EStructuralFeature } from '@emfts/core';

const props = defineProps<{
  eObject: EObject;
  feature: EStructuralFeature;
  custom?: {
    resolvedStyle?: { readOnly?: boolean; label?: string; css?: string };
    rawWidget?: any;
  };
}>();

const label = computed(() => {
  return props.custom?.resolvedStyle?.label
    ?? props.custom?.rawWidget?.label
    ?? props.feature?.getName?.()
    ?? '';
});

const isReadOnly = computed(() => {
  return props.custom?.resolvedStyle?.readOnly
    ?? props.custom?.rawWidget?.readOnly
    ?? false;
});

const value = computed({
  get() {
    const val = props.eObject.eGet(props.feature);
    if (val == null) return '';
    if (typeof val === 'string') return val;
    // EList / Iterable → join
    if (Symbol.iterator in Object(val)) {
      const items = Array.from(val as Iterable<any>);
      return items.map((item) => {
        if (typeof item === 'string') return item;
        // PlainLiteral etc.
        const f = item?.eClass?.()?.getEStructuralFeature?.('value');
        if (f) return item.eGet(f) ?? '';
        const nf = item?.eClass?.()?.getEStructuralFeature?.('name');
        if (nf) return item.eGet(nf) ?? '';
        return String(item);
      }).join(', ');
    }
    // EObject → try name/value/about
    if (typeof val === 'object' && val.eClass) {
      const nameF = val.eClass()?.getEStructuralFeature?.('name');
      if (nameF) return val.eGet(nameF) ?? '';
      const valF = val.eClass()?.getEStructuralFeature?.('value');
      if (valF) return val.eGet(valF) ?? '';
    }
    return String(val);
  },
  set(newVal: string) {
    if (!isReadOnly.value) {
      props.eObject.eSet(props.feature, newVal);
    }
  },
});

const cssClass = computed(() => props.custom?.resolvedStyle?.css ?? '');
</script>

<template>
  <div class="field" :class="[cssClass, { 'field--readonly': isReadOnly }]">
    <label class="field__label">{{ label }}</label>
    <input
      v-if="!isReadOnly"
      v-model="value"
      class="field__input"
      type="text"
    />
    <div v-else class="field__value">{{ value || '—' }}</div>
  </div>
</template>
