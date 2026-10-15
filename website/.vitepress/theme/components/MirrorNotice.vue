<script setup lang="ts">
// Keep the source language and normative/explanatory distinction visible.
withDefaults(
  defineProps<{
    source: string;
    url?: string;
    normative: boolean;
    sourceLanguage?: string;
    releaseState?: string;
  }>(),
  { normative: false, sourceLanguage: "en", releaseState: "published" },
);
</script>

<template>
  <aside
    class="mirror-notice"
    :data-document-authority="normative ? 'normative' : 'non-normative'"
    :data-release-state="releaseState"
  >
    <p>
      {{ normative ? `Normative source (English original):` : `Explanatory source (English original):` }}
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      <template v-if="!normative"> — not a specification requirement.</template>
    </p>
  </aside>
</template>

<style scoped>
.mirror-notice {
  margin: 0 0 24px;
  padding: 12px 16px;
  border-inline-start: 2px solid var(--vp-c-brand-1);
  border-radius: 0 4px 4px 0;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.7;
}

.mirror-notice p {
  margin: 0;
  overflow-wrap: anywhere;
}

/* The notice sits outside .vp-doc, so VitePress's prose link style does not
   reach it; keep the source link recognisable as a link. */
.mirror-notice a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.mirror-notice a:hover {
  text-decoration-thickness: 2px;
}

.mirror-notice code {
  color: inherit;
  font-size: 0.875em;
}
</style>
