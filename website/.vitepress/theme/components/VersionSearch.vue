<script setup lang="ts">
import localSearchIndex from "@localSearchIndex";
import MiniSearch, { type SearchResult } from "minisearch";
import { useRoute, useRouter } from "vitepress";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { defaultSearchScope, resultVersion, searchResults } from "../../search-scope.mjs";

type Scope = "all" | "v1" | "v2";
type IndexedResult = SearchResult & { title?: string; titles?: string[] };
type Index = MiniSearch<{ title: string; titles: string[] }>;

const emit = defineEmits<{ (event: "close"): void }>();
const route = useRoute();
const router = useRouter();
const dialog = ref<HTMLDialogElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const scope = ref<Scope>(defaultSearchScope(route.path) as Scope);
const index = ref<Index | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const selected = ref(0);
const results = computed(() => index.value
  ? searchResults(index.value, query.value, scope.value) as IndexedResult[]
  : []);

const text = {
  search: "Search documentation",
  placeholder: "Search documentation",
  scope: "Search scope",
  all: "All versions",
  v1: "v1 + common",
  v2: "v2 + common",
  close: "Close search",
  loading: "Loading search index…",
  error: "Search index could not be loaded. Close and try again.",
  prompt: "Enter a search term.",
  empty: "No results in this scope. Try all versions.",
  count: (n: number) => `${n} results`,
  common: "Common",
};

let previousFocus: HTMLElement | null = null;
let previousOverflow = "";
let finished = false;
let loadGeneration = 0;

async function loadIndex() {
  const generation = ++loadGeneration;
  state.value = "loading";
  index.value = null;
  try {
    const loader = localSearchIndex.root;
    if (!loader) throw new Error("No documentation search index");
    const json = (await loader()).default;
    const loaded = MiniSearch.loadJSON<{ title: string; titles: string[] }>(json, {
      fields: ["title", "titles", "text"],
      storeFields: ["title", "titles"],
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        boost: { title: 4, text: 2, titles: 1 },
      },
    });
    if (generation !== loadGeneration) return;
    index.value = loaded;
    state.value = "ready";
  } catch {
    if (generation === loadGeneration) state.value = "error";
  }
}

function finish() {
  if (finished) return;
  finished = true;
  document.body.style.overflow = previousOverflow;
  emit("close");
  nextTick(() => {
    const target = previousFocus && previousFocus !== document.body && previousFocus.isConnected
      ? previousFocus
      : document.querySelector<HTMLElement>("#local-search button");
    target?.focus();
  });
}

function close() {
  if (dialog.value?.open) dialog.value.close();
  else finish();
}

function onBackdropClick(event: MouseEvent) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) close();
}

function navigate(result: IndexedResult, event?: MouseEvent) {
  if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
  event?.preventDefault();
  close();
  void router.go(result.id);
}

function revealSelectedResult() {
  nextTick(() => {
    document.getElementById(`version-search-result-${selected.value}`)?.scrollIntoView({ block: "nearest" });
  });
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.target === input.value && event.key === "ArrowDown" && results.value.length) {
    event.preventDefault();
    selected.value = (selected.value + 1) % results.value.length;
    revealSelectedResult();
  } else if (event.target === input.value && event.key === "ArrowUp" && results.value.length) {
    event.preventDefault();
    selected.value = (selected.value - 1 + results.value.length) % results.value.length;
    revealSelectedResult();
  } else if (event.key === "Enter" && event.target === input.value && results.value.length) {
    event.preventDefault();
    navigate(results.value[selected.value]);
  }
}

watch([query, scope], () => { selected.value = 0; });

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  dialog.value?.showModal();
  input.value?.focus();
  void loadIndex();
});

onBeforeUnmount(() => {
  loadGeneration++;
  if (!finished) {
    document.body.style.overflow = previousOverflow;
    (previousFocus && previousFocus !== document.body && previousFocus.isConnected
      ? previousFocus
      : document.querySelector<HTMLElement>("#local-search button"))?.focus();
  }
});
</script>

<template>
  <dialog ref="dialog" class="VersionSearch" :aria-label="text.search"
    @close="finish" @click="onBackdropClick" @keydown="onKeydown">
    <div class="VersionSearch-head">
      <input ref="input" v-model="query" type="search" role="combobox" :aria-label="text.search"
        :placeholder="text.placeholder" autocomplete="off" spellcheck="false"
        aria-autocomplete="list" :aria-expanded="results.length > 0"
        :aria-controls="results.length ? 'version-search-results' : undefined"
        :aria-activedescendant="results.length ? `version-search-result-${selected}` : undefined" />
      <button type="button" :aria-label="text.close" @click="close">×</button>
    </div>
    <div class="VersionSearch-scope">
      <label for="version-search-scope">{{ text.scope }}</label>
      <select id="version-search-scope" v-model="scope">
        <option value="all">{{ text.all }}</option>
        <option value="v1">{{ text.v1 }}</option>
        <option value="v2">{{ text.v2 }}</option>
      </select>
    </div>
    <p v-if="state === 'loading'" class="VersionSearch-message" role="status">{{ text.loading }}</p>
    <p v-else-if="state === 'error'" class="VersionSearch-message" role="alert">{{ text.error }}</p>
    <p v-else-if="!query.trim()" class="VersionSearch-message">{{ text.prompt }}</p>
    <p v-else-if="!results.length" class="VersionSearch-message" role="status">{{ text.empty }}</p>
    <template v-else>
      <p class="VersionSearch-count" role="status">{{ text.count(results.length) }}</p>
      <ul id="version-search-results" class="VersionSearch-results" role="listbox"
        :aria-label="text.search">
        <li v-for="(result, i) in results" :id="`version-search-result-${i}`" :key="result.id"
          role="option" :aria-selected="selected === i" :class="{ selected: selected === i }">
          <a :href="result.id" @mouseenter="selected = i" @click="navigate(result, $event)">
            <span class="VersionSearch-title">{{ result.title || result.id }}</span>
            <span class="VersionSearch-tag">{{ resultVersion(result.id) ?? text.common }}</span>
            <small v-if="result.titles?.length">{{ result.titles.join(" › ") }}</small>
          </a>
        </li>
      </ul>
    </template>
  </dialog>
</template>

<style scoped>
.VersionSearch {
  width: min(42rem, calc(100vw - 1.5rem));
  max-height: min(38rem, calc(100dvh - 1.5rem));
  margin: min(12vh, 5rem) auto auto;
  padding: 0;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  box-shadow: var(--vp-shadow-3);
}
.VersionSearch::backdrop { background: var(--vp-backdrop-bg-color); }
.VersionSearch-head { display: flex; align-items: center; border-bottom: 1px solid var(--vp-c-divider); }
.VersionSearch-head input { min-width: 0; min-height: 3rem; flex: 1; padding: .75rem 1rem; background: transparent; outline-offset: -3px; }
.VersionSearch-head button { min-width: 3rem; min-height: 3rem; font-size: 1.5rem; }
.VersionSearch-scope { display: flex; align-items: center; gap: .75rem; padding: .7rem 1rem; border-bottom: 1px solid var(--vp-c-divider); }
.VersionSearch-scope label { flex: none; color: var(--vp-c-text-2); font-size: .875rem; }
.VersionSearch-scope select { min-width: 0; min-height: 44px; padding: .35rem .5rem; color: var(--vp-c-text-1); background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); border-radius: 6px; }
.VersionSearch-message, .VersionSearch-count { padding: 1rem; color: var(--vp-c-text-2); }
.VersionSearch-count { padding-bottom: .25rem; font-size: .8rem; }
.VersionSearch-results { max-height: 26rem; overflow-y: auto; padding: .25rem; }
.VersionSearch-results li { border-radius: 6px; }
.VersionSearch-results li.selected { background: var(--vp-c-bg-soft); }
.VersionSearch-results a { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .15rem .7rem; padding: .7rem .75rem; color: var(--vp-c-text-1); text-decoration: none; }
.VersionSearch-results a:focus-visible, .VersionSearch-head button:focus-visible, .VersionSearch-scope select:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px; }
.VersionSearch-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.VersionSearch-tag { color: var(--vp-c-text-2); font-size: .75rem; }
.VersionSearch-results small { grid-column: 1 / -1; color: var(--vp-c-text-2); }
</style>
