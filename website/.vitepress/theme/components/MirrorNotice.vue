<script setup lang="ts">
import { useData } from "vitepress";
const { lang } = useData();
// A mirrored page is a derived copy, not the authority. Readers who arrive
// from a search result have no other way to know which of the two bytes they
// are quoting, so every mirrored page says so above its first heading. The
// generator supplies authority and release state independently: a mutable
// index must never inherit normative wording, nor confuse v2's public,
// revision-open contract with v1's frozen publication.
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
    <p v-if="releaseState === 'revision-open' && lang === 'ja-JP'">
      {{ normative ? 'v2規範文書の原文' : 'v2の非規範的な解説の原文' }}（英語・改訂可能）:
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>。
      {{ normative ? '本文は今後も変更されることがあります。' : 'この解説は改訂可能で、規範文書ではありません。' }}
      公開版は<a href="https://takoform.com/v2/">takoform.com</a>で確認できます。プレビューは公開版と異なる場合があります。
    </p>
    <p v-else-if="releaseState === 'revision-open'">
      {{ normative ? 'V2 normative source' : 'V2 non-normative explanatory source' }}
      (English, revision-open):
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>.
      {{ normative ? 'The text remains open to revision.' : 'This explanation may change and is not normative.' }}
      See <a href="https://takoform.com/en/v2/">takoform.com</a> for the published version. Previews may differ.
    </p>
    <p v-else-if="releaseState === 'unpublished' && lang === 'ja-JP'">
      {{ normative ? 'v2仕様の原文' : 'v2の解説' }}（{{ sourceLanguage === 'ja-JP' ? '日本語' : '英語' }}）:
      <code>{{ source }}</code>。公開準備中です。
    </p>
    <p v-else-if="releaseState === 'unpublished'">
      {{ normative ? 'V2 specification source' : 'V2 explanatory source' }}
      ({{ sourceLanguage === 'ja-JP' ? 'Japanese' : 'English' }}):
      <code>{{ source }}</code>. Publication is being prepared.
    </p>
    <p v-else-if="lang === 'ja-JP'">
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
      Index source:
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      ({{ sourceLanguage === 'ja-JP' ? 'Japanese' : 'English' }}). This is a navigation guide, not a specification.
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
