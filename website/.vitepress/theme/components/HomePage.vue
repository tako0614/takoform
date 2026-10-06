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
          <h1 id="home-title">Takoform</h1>
          <p v-if="isEnglish" class="home-overview__lead">
            A common HTTP API for managing resources.
          </p>
          <p v-else class="home-overview__lead">
            リソースを扱うための共通HTTP API。
          </p>
        </header>

        <div class="home-introduction">
          <p v-if="isEnglish">
            A Form defines a resource's inputs, outputs and behavior. A Host implements the
            Form. Clients use the Host API to create, inspect, update and delete resources.
          </p>
          <p v-else>
            Formがリソースの入力・出力・振る舞いを定め、Hostがそれを実装します。クライアントはHost APIを通じて、リソースの作成・取得・更新・削除を行います。
          </p>
          <p v-if="isEnglish">
            Resource-specific behavior belongs to each Form; the common API describes how to
            manage it. Hosts choose their own implementation and which Forms to support.
            This site documents the common API. Individual Form specifications belong to their publishers.
          </p>
          <p v-else>
            リソースごとの意味はFormに、共通の操作方法はAPIに分けます。Hostは実装方法と対応するFormを選べます。このサイトでは共通APIを説明し、個別Formの仕様はそれぞれの公開元で案内します。
          </p>
        </div>
      </section>

      <nav class="home-index" aria-labelledby="home-index-title">
        <h2 id="home-index-title">{{ isEnglish ? "API documentation" : "APIドキュメント" }}</h2>
        <ul>
          <li>
            <a :href="`${localePrefix}/v1/`">Host API v1</a>
            <p>{{ isEnglish ? "Read the fixed v1 API, common model and schemas." : "固定されたv1 API、共通モデル、スキーマを参照できます。" }}</p>
          </li>
          <li>
            <a :href="`${localePrefix}/v2/`">Host API v2</a>
            <p>{{ isEnglish ? "Read the fixed v2 API and its implementation guides." : "固定されたv2 APIと実装ガイドを参照できます。" }}</p>
          </li>
        </ul>
      </nav>
    </div>
  </main>
</template>

<style src="../home.css"></style>
