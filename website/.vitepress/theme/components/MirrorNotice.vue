<script setup lang="ts">
// A mirrored page is a published copy, not the authority. Readers who arrive
// from a search result have no other way to know which of the two bytes they
// are quoting, so every mirrored page says so above its first heading. The
// generator supplies the classification from the Host API freeze: a mutable
// index must never inherit the normative wording used for a frozen contract.
withDefaults(
  defineProps<{ source: string; url?: string; normative: boolean }>(),
  { normative: false },
);
</script>

<template>
  <aside
    class="mirror-notice"
    :data-document-authority="normative ? 'normative' : 'non-normative'"
  >
    <p v-if="normative">
      This page publishes
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      from the frozen source repository. That repository copy is the normative
      one; this page moves only the link addresses.
    </p>
    <p v-else>
      This page publishes the non-normative index
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      from the source repository. It is a navigation aid, not a contract; use
      the contract links it names for normative requirements.
    </p>
  </aside>
</template>

<style scoped>
.mirror-notice {
  margin: 0 0 var(--space-xl);
  padding: var(--space-sm) var(--space-md);
  border-inline-start: var(--rule-strong) solid var(--vp-c-brand-1);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: var(--text-sm);
  line-height: 1.7;
}

.mirror-notice p {
  margin: 0;
}
</style>
