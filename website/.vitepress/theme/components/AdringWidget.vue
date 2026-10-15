<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";

const container = ref<HTMLDivElement>();
const unavailable = ref(false);
let dispose: (() => void) | undefined;

onMounted(() => {
  const element = container.value;
  if (!element) return;
  const script = document.createElement("script");
  script.src = "https://ar-cdn.net/widget/v1.js";
  script.async = true;
  script.referrerPolicy = "origin";
  script.dataset.siteId = "97ea1be2-f52c-4c3c-9543-145ca513beef";
  script.dataset.variant = "card";
  // A blocked script never creates a widget, so nothing else would release the space.
  script.addEventListener("error", () => { unavailable.value = true; });
  element.append(script);
  dispose = () => {
    (script as HTMLScriptElement & { __adringCleanup?: () => void }).__adringCleanup?.();
    element.replaceChildren();
  };
});

onBeforeUnmount(() => dispose?.());
</script>

<template>
  <aside aria-label="Advertisement" class="adring-placement" :hidden="unavailable">
    <div ref="container" />
  </aside>
</template>

<style scoped>
/* The widget hides itself when it has nothing to show or its fill request
   fails; drop the reserved space and the empty landmark with it. */
.adring-placement:has([data-adring-widget]:is([data-adring-state="empty"], [data-adring-state="error"])),
.adring-placement[hidden] {
  display: none;
}

.adring-placement {
  box-sizing: border-box;
  width: 100%;
  max-width: 488px;
  min-height: 196px;
  margin: 0 auto;
  padding: 24px;
}
</style>
