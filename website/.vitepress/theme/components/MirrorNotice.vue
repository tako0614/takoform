<script setup lang="ts">
import { useData } from "vitepress";
const { lang } = useData();
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
    <p v-if="lang === 'ja-JP'">
      {{ normative ? '仕様の原文（英語・固定済み）:' : '案内文の原文（英語）:' }}
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>。
      {{ normative ? '本文は英語の原文を掲載しています。リンク先だけを置き換えており、正本はリポジトリ内のファイルです。' : '本文は英語の案内文です。仕様そのものではありません。' }}
    </p>
    <p v-else-if="normative">
      Specification source:
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      (frozen). This copy changes link addresses only; the repository file is authoritative.
    </p>
    <p v-else>
      Index source:
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      . This is a navigation guide, not a specification.
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
}
</style>
