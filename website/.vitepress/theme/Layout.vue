<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";
import { onBeforeUnmount, onMounted } from "vue";

import MirrorNotice from "./components/MirrorNotice.vue";
import AdringWidget from "./components/AdringWidget.vue";
import VersionContext from "./components/VersionContext.vue";
import NotFoundPage from "./components/NotFoundPage.vue";

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
    <template #nav-bar-content-after>
      <VersionContext />
    </template>
    <template #not-found>
      <NotFoundPage />
    </template>
    <template #layout-bottom>
      <AdringWidget />
    </template>
    <template #doc-before>
      <VersionContext variant="status" />
      <MirrorNotice
        v-if="frontmatter.canonicalSource"
        :source="frontmatter.canonicalSource"
        :url="frontmatter.canonicalUrl"
        :normative="frontmatter.normative === true"
        :source-language="frontmatter.sourceLanguage"
        :release-state="frontmatter.releaseState"
        :host-api-version="frontmatter.hostApiVersion"
      />
    </template>
  </Layout>
</template>
