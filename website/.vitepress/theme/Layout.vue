<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";
import { onBeforeUnmount, onMounted } from "vue";

import MirrorNotice from "./components/MirrorNotice.vue";
import AdringWidget from "./components/AdringWidget.vue";

const { Layout } = DefaultTheme;
const { frontmatter } = useData();

function closeMobileNavigation(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const trigger = document.querySelector<HTMLButtonElement>(
    '.VPNavBarHamburger[aria-expanded="true"]',
  );
  if (trigger === null) return;
  event.preventDefault();
  trigger.click();
  trigger.focus();
}

onMounted(() => window.addEventListener("keydown", closeMobileNavigation));
onBeforeUnmount(() => window.removeEventListener("keydown", closeMobileNavigation));
</script>

<template>
  <Layout>
    <template #layout-bottom>
      <AdringWidget />
    </template>
    <template #doc-before>
      <MirrorNotice
        v-if="frontmatter.canonicalSource"
        :source="frontmatter.canonicalSource"
        :url="frontmatter.canonicalUrl"
        :normative="frontmatter.normative === true"
      />
    </template>
  </Layout>
</template>
