<script setup lang="ts">
const entries = [
  { path: "/", label: "Overview", text: "What Takoform is and how Forms, Hosts and clients work together." },
  { path: "/start/", label: "Getting started with v2", text: "Follow one fictional resource from Discovery through create, update and delete." },
  { path: "/v2/", label: "Host API v2", text: "The v2 specification and implementation guides." },
  { path: "/v1/", label: "Host API v1", text: "The retained v1 specification, common model and verification resources." },
];

// The navigation bar owns the search dialog, so open it through its trigger.
// The dialog returns focus to this page's button when it closes.
function openSearch() {
  document.querySelector<HTMLButtonElement>("#local-search button")?.click();
}
</script>

<template>
  <main class="not-found" aria-labelledby="not-found-title">
    <div class="not-found__inner">
      <p class="not-found__code" aria-hidden="true">404</p>
      <h1 id="not-found-title">Page not found</h1>
      <p>
        There is no page at this address. It may be a link to an earlier site route
        that is no longer published.
      </p>
      <button type="button" class="not-found__search" @click="openSearch">Search the documentation</button>
      <ul class="not-found__entries">
        <li v-for="entry in entries" :key="entry.path">
          <a class="not-found__link" :href="entry.path">{{ entry.label }}</a>
          <p>{{ entry.text }}</p>
        </li>
      </ul>
    </div>
  </main>
</template>

<style scoped>
/* Hallmark · genre: modern-minimal · design-system: design.md · theme: retained VitePress · motion: none */
.not-found {
  --not-found-space-xs: 0.5rem;
  --not-found-space-sm: 1rem;
  --not-found-space-md: 1.5rem;
  --not-found-space-lg: 2rem;
  --not-found-space-xl: 3rem;
  --not-found-space-2xl: 4rem;
  padding-block: var(--not-found-space-xl);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-base);
  line-height: 1.8;
}
.not-found__inner {
  width: min(100%, 46rem);
  margin-inline: auto;
  padding-inline: var(--not-found-space-sm);
}
.not-found p { margin: 0; }
.not-found__code {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.875rem;
  font-weight: 600;
}
.not-found h1 {
  margin: var(--not-found-space-xs) 0 var(--not-found-space-sm);
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  font-style: normal;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.not-found__search {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-block: var(--not-found-space-md) var(--not-found-space-lg);
  padding-inline: var(--not-found-space-md);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 6px;
  color: var(--vp-c-brand-1);
  font-size: 1rem;
  font-weight: 600;
  white-space: nowrap;
}
.not-found__search:hover { background: var(--vp-c-brand-soft); }
.not-found__search:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}
.not-found__entries {
  margin: 0;
  padding: 0;
  list-style: none;
  border-block-start: 1px solid var(--vp-c-divider);
}
.not-found__entries li {
  padding-block: var(--not-found-space-xs) var(--not-found-space-sm);
  border-block-end: 1px solid var(--vp-c-divider);
}
.not-found__link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  max-width: 100%;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.not-found__link:hover { text-decoration-thickness: 2px; }
.not-found__entries p { color: var(--vp-c-text-2); }
@media (min-width: 40rem) {
  .not-found { padding-block: var(--not-found-space-2xl); }
  .not-found__inner { padding-inline: var(--not-found-space-lg); }
}
</style>
