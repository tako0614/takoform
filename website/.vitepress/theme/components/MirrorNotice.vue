<script setup lang="ts">
// Keep the source language and normative/explanatory distinction visible.
withDefaults(
  defineProps<{
    source: string;
    url?: string;
    normative: boolean;
    sourceLanguage?: string;
    releaseState?: string;
    hostApiVersion?: string;
  }>(),
  { normative: false, sourceLanguage: "en", releaseState: "published" },
);
</script>

<template>
  <aside
    class="mirror-notice"
    aria-label="About this page"
    :data-document-authority="normative ? 'normative' : 'non-normative'"
    :data-release-state="releaseState"
  >
    <p>
      {{ normative ? `Normative source (English original):` : `Explanatory source (English original):` }}
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      <template v-if="!normative"> — not a specification requirement.</template>
    </p>
    <!-- A reader may land on a Host API v1 document from search or a link
         without passing the v1 entry page, so say which API it belongs to. -->
    <p v-if="hostApiVersion === 'v1'" class="mirror-notice-version">
      Part of the <a href="/v1/">Host API v1</a> documents: a lane, profile,
      or identity they call “current” is the one in Host API v1.
      <a href="/v2/">Host API v2</a> is a separate specification and does not
      change v1 requirements.
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

.mirror-notice p + p {
  margin-top: 4px;
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
