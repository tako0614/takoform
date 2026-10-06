<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vitepress";
import { documentVersion, versionTarget } from "../../versions.mjs";

withDefaults(defineProps<{ variant?: "control" | "status" }>(), {
  variant: "control",
});

const route = useRoute();
const router = useRouter();
const changingVersion = ref(false);
const currentPath = computed(() => route.path);
const currentVersion = computed(() => documentVersion(currentPath.value));
const isEnglish = computed(() => currentPath.value === "/en" || currentPath.value.startsWith("/en/"));
const currentStatus = computed(() => {
  if (currentVersion.value === "v1") return isEnglish.value ? "Frozen" : "凍結済み";
  if (currentVersion.value === "v2") return isEnglish.value ? "Fixed" : "固定済み";
  return "";
});
const controlLabel = computed(() => isEnglish.value
  ? currentVersion.value
    ? `Documentation version, current ${currentVersion.value}, ${currentStatus.value}`
    : "Documentation version, v1 frozen, v2 fixed"
  : currentVersion.value
    ? `文書の版、現在 ${currentVersion.value}、${currentStatus.value}`
    : "文書の版、v1凍結済み、v2固定済み");

const options = computed(() => [
  { version: "v1", label: "API v1" },
  { version: "v2", label: "API v2" },
]);

async function changeVersion(event: Event) {
  const version = (event.target as HTMLSelectElement).value;
  if (changingVersion.value || (version !== "v1" && version !== "v2")) return;
  changingVersion.value = true;
  try {
    await router.go(versionTarget(currentPath.value, version));
  } finally {
    changingVersion.value = false;
  }
}
</script>

<template>
  <p v-if="variant === 'status' && currentVersion" class="version-status">
    <span>{{ currentVersion }}</span>
    <span aria-hidden="true"> · </span>
    <span>{{ currentStatus }}</span>
  </p>
  <label v-else-if="variant === 'control'" class="version-context">
    <span class="visually-hidden">{{ isEnglish ? "Documentation version" : "文書の版" }}</span>
    <select
      :value="currentVersion ?? 'shared'"
      :disabled="changingVersion"
      :title="currentStatus"
      :aria-label="controlLabel"
      @change="changeVersion"
    >
      <option value="shared" disabled>{{ isEnglish ? "Docs" : "文書" }}</option>
      <option v-for="item in options" :key="item.version" :value="item.version">{{ item.label }}</option>
    </select>
    <span class="vpi-chevron-down version-chevron" aria-hidden="true"></span>
  </label>
</template>

<style scoped>
.version-status {
  margin: 0 0 0.75rem;
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
  line-height: 1.4;
}

.version-context {
  position: relative;
  display: block;
  flex: 0 0 auto;
  margin-inline: 0.35rem;
}

.version-context select {
  box-sizing: border-box;
  width: 7rem;
  max-width: calc(100vw - 11.875rem);
  min-height: 44px;
  padding: 0.35rem 1.8rem 0.35rem 0.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg);
  font-size: 0.75rem;
  line-height: 1.3;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}

.version-context select:disabled {
  cursor: wait;
  opacity: 0.75;
}

.version-chevron {
  position: absolute;
  top: 50%;
  right: 0.45rem;
  width: 0.75rem;
  height: 0.75rem;
  color: var(--vp-c-text-2);
  pointer-events: none;
  transform: translateY(-50%) rotate(90deg);
}

.version-context select:hover {
  border-color: var(--vp-c-brand-1);
}

.version-context select:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 359px) {
  .version-context {
    margin-inline: 0.15rem;
  }

  .version-context select {
    width: 6.5rem;
    max-width: calc(100vw - 11.875rem);
  }

  :global(.VPNavBar .wrapper) {
    padding-right: 4px;
    padding-left: 12px;
  }

  :global(.VPNavBar .container > .title) {
    flex: 0 1 5.75rem;
    min-width: 0;
    max-width: 5.75rem;
  }

  :global(.VPNavBar .container > .title .title) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.VPNavBar .content) {
    min-width: 0;
  }

  :global(.VPNavBar .content-body) {
    column-gap: 2px;
  }
}
</style>
