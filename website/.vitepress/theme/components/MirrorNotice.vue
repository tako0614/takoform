<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
const { lang } = useData();
// Keep the source language and normative/explanatory distinction visible.
const props = withDefaults(
  defineProps<{
    source: string;
    url?: string;
    normative: boolean;
    sourceLanguage?: string;
    releaseState?: string;
  }>(),
  { normative: false, sourceLanguage: "en", releaseState: "published" },
);
const sourceLanguageName = computed(() => {
  const isJapaneseSource = props.sourceLanguage === "ja-JP";
  if (lang.value === "ja-JP") return isJapaneseSource ? "日本語" : "英語";
  return isJapaneseSource ? "Japanese" : "English";
});
</script>

<template>
  <aside
    class="mirror-notice"
    :data-document-authority="normative ? 'normative' : 'non-normative'"
    :data-release-state="releaseState"
  >
    <p v-if="lang === 'ja-JP'">
      {{ normative ? `規範原文（${sourceLanguageName}）:` : `解説原文（${sourceLanguageName}）:` }}
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>{{ normative ? "。" : "。規範要件ではありません。" }}
    </p>
    <p v-else>
      {{ normative ? `Normative source (${sourceLanguageName} original):` : `Explanatory source (${sourceLanguageName} original):` }}
      <a v-if="url" :href="url"><code>{{ source }}</code></a>
      <code v-else>{{ source }}</code>
      <template v-if="!normative"> Not a specification requirement.</template>
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
