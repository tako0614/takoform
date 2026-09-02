<script setup lang="ts">
// A mirrored page is a published copy, not the authority. Readers who arrive
// from a search result have no other way to know which of the two bytes they
// are quoting, so every mirrored page says so above its first heading.
defineProps<{ source: string; url?: string }>();
</script>

<template>
  <aside class="mirror-notice">
    <p>
      This page publishes
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      from the source repository. The repository copy is the normative one; this
      page moves only the link addresses.
    </p>
  </aside>
</template>

<style scoped>
.mirror-notice {
  margin: 0 0 32px;
  padding: 12px 16px;
  border-inline-start: 3px solid var(--vp-c-brand-1);
  border-radius: 0 6px 6px 0;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.7;
}

.mirror-notice p {
  margin: 0;
}
</style>
