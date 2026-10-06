<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";

const { lang } = useData();
const isEnglish = computed(() => lang.value === "en");
const localePrefix = computed(() => (isEnglish.value ? "/en" : ""));
</script>

<template>
  <main class="home-page">
    <div class="home-page__inner">
      <section class="home-overview" aria-labelledby="home-title">
        <header class="home-overview__copy">
          <p class="home-status">Takoform · Host API v2</p>
          <h1 id="home-title">
            <template v-if="isEnglish">Form specifications and Host API v2</template>
            <template v-else><span class="home-title__phrase">Form仕様と</span><span class="home-title__phrase">Host API v2</span></template>
          </h1>
          <p v-if="isEnglish" class="home-overview__lead">
            Form authors publish versioned resource specifications. Hosts implement the Forms they
            support; clients manage Resources through a shared HTTP contract.
          </p>
          <p v-else class="home-overview__lead">
            Form作者は版固定URLで資源の仕様を公開します。Hostは対応するFormを実装し、クライアントは共通のHTTP APIでResourceを管理します。
          </p>
        </header>

        <section class="home-request" aria-labelledby="home-request-title">
          <div class="home-request__heading">
            <h2 id="home-request-title">{{ isEnglish ? "Illustrative v2 create request" : "v2の作成要求例" }}</h2>
            <span>API v2</span>
          </div>
          <p class="home-request__path">
            <code>POST</code>
            <code>/apis/forms.takoform.com/v2/resources</code>
          </p>
          <pre class="home-request__body"><code>{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default",
  "name": "greeting",
  "spec": {
    "key": "greeting",
    "value": "hello"
  }
}</code></pre>
          <p class="home-request__note">
            {{
              isEnglish
                ? "Fictional request body; see the examples for headers and Operation responses. No live Host is implied."
                : "架空の要求本文です。ヘッダーとOperation応答は具体例を参照してください。実在Hostを示しません。"
            }}
          </p>
        </section>
      </section>

      <nav class="home-index" aria-labelledby="home-index-title">
        <h2 id="home-index-title">{{ isEnglish ? "Documentation" : "ドキュメント" }}</h2>
        <ul>
          <li>
            <a :href="`${localePrefix}/v2/`">{{ isEnglish ? "Host API v2 overview" : "Host API v2 概要" }}</a>
            <p>{{ isEnglish ? "Purpose, terms and specification map." : "目的、用語、仕様の構成。" }}</p>
          </li>
          <li>
            <a :href="`${localePrefix}/spec/host-api/v2/http`">HTTP API</a>
            <p>{{ isEnglish ? "Requests, responses, errors and retries." : "要求と応答、エラー、再試行の規則。" }}</p>
          </li>
          <li>
            <a :href="`${localePrefix}/spec/host-api/v2/forms`">{{ isEnglish ? "Write a Form" : "Formの仕様を書く" }}</a>
            <p>{{ isEnglish ? "Define inputs, behavior and the meaning of a resource." : "入力と挙動を定め、リソースの仕様を公開する。" }}</p>
          </li>
          <li>
            <a :href="`${localePrefix}/spec/host-api/v2/examples`">{{ isEnglish ? "Request examples" : "リクエスト例" }}</a>
            <p>{{ isEnglish ? "Follow a resource from creation through updates to deletion." : "一つ作って、更新して、削除するまで。" }}</p>
          </li>
        </ul>
      </nav>

      <aside class="home-archive" :aria-label="isEnglish ? 'Existing v1 documentation' : '既存のv1資料'">
        <p v-if="isEnglish">
          v1 reference — the earlier contract is retained in the
          <a :href="`${localePrefix}/spec/host-api/v1`">frozen Host API v1 specification</a>.
          V2 source authority and publication status are identified on its specification pages.
        </p>
        <p v-else>
          v1資料 — 以前の契約は
          <a :href="`${localePrefix}/spec/host-api/v1`">凍結されたHost API v1仕様</a>
          に保存しています。v2仕様ページには原文の言語と公開状況を表示しています。
        </p>
      </aside>
    </div>
  </main>
</template>

<style src="../home.css"></style>
