<script setup lang="ts">
import { useData } from "vitepress";
const { lang } = useData();
// A mirrored page is a derived copy, not the authority. Readers who arrive
// from a search result have no other way to know which of the two bytes they
// are quoting, so every mirrored page says so above its first heading. The
// generator supplies authority and release state independently: a mutable
// index must never inherit normative wording. Both published API contracts
// are fixed; their surrounding explanations are not additional requirements.
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
    <p v-if="lang === 'ja-JP'">
      {{ normative ? `仕様の原文（${sourceLanguage === 'ja-JP' ? '日本語' : '英語'}・固定済み）:` : `案内文の原文（${sourceLanguage === 'ja-JP' ? '日本語' : '英語'}）:` }}
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>。
      {{ normative ? '本文は英語の原文を掲載しています。リンク先だけを置き換えており、正とする情報はリポジトリ内のファイルです。' : '本文は英語の案内文です。仕様そのものではありません。' }}
    </p>
    <p v-else-if="normative">
      Specification source:
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      ({{ sourceLanguage === 'ja-JP' ? 'Japanese' : 'English' }}, frozen). This copy changes link addresses only; the repository file is authoritative.
    </p>
    <p v-else>
      Explanatory source:
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      ({{ sourceLanguage === 'ja-JP' ? 'Japanese' : 'English' }}). This explanation is not a normative specification.
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
