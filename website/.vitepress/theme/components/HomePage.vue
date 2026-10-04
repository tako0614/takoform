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
          <p class="home-status">Takoform</p>
          <h1 id="home-title">
            <template v-if="isEnglish">A common API for infrastructure.</template>
            <template v-else><span class="home-title__phrase">インフラを、</span><span class="home-title__phrase">共通のAPIで。</span></template>
          </h1>
          <p v-if="isEnglish" class="home-overview__lead">
            Publish a database or storage specification at a URL. Implement it on a server, then
            create, update and delete resources through a shared protocol.
          </p>
          <p v-else class="home-overview__lead">
            データベースやストレージの仕様をURLで公開し、対応するサーバーで作成・更新・削除するためのプロトコルです。
          </p>
        </header>

        <section class="home-request" aria-labelledby="home-request-title">
          <div class="home-request__heading">
            <h2 id="home-request-title">{{ isEnglish ? "Create a resource" : "リソースを作成する" }}</h2>
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
            {{ isEnglish ? "Request headers are omitted." : "リクエストヘッダーは省略しています。" }}
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
          v1 references — for existing software, see
          <a :href="`${localePrefix}/host-api/`">Host API v1</a> and
          <a :href="`${localePrefix}/use/`">Provider usage</a>.
          v1 is retained without changes. V2 publication status is recorded in the overview.
        </p>
        <p v-else>
          v1資料 — 現行ソフトウェアを参照する場合は
          <a :href="`${localePrefix}/host-api/`">Host API v1</a> と
          <a :href="`${localePrefix}/use/`">Provider利用案内</a> を参照してください。
          v1は内容を固定して保存しています。v2の公開状況は概要に記載しています。
        </p>
      </aside>
    </div>
  </main>
</template>

<style src="../home.css"></style>
