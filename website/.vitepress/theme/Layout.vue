<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";

import MirrorNotice from "./components/MirrorNotice.vue";

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <Layout>
    <template #doc-before>
      <MirrorNotice
        v-if="frontmatter.canonicalSource"
        :source="frontmatter.canonicalSource"
        :url="frontmatter.canonicalUrl"
      />
    </template>
  </Layout>
</template>
