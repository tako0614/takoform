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
            Resource specifications and a common HTTP API for managing them.
          </p>
          <p v-else class="home-overview__lead">
            リソースの仕様と、操作のための共通HTTP API。
          </p>
        </header>

        <div class="home-introduction">
          <p v-if="isEnglish">
            A Form describes a resource. A Host implements it. A client uses the Host API to
            create, inspect, update and delete resources. Read the documentation for the API
            version your implementation uses.
          </p>
          <p v-else>
            Formがリソースの仕様を定め、Hostがそれを実装します。クライアントはHost APIを使って作成・取得・更新・削除を行います。利用するAPIの版を選んで読み進めてください。
          </p>
        </div>
      </section>

      <nav class="home-index" aria-labelledby="home-index-title">
        <h2 id="home-index-title">{{ isEnglish ? "Choose an API version" : "APIの版を選ぶ" }}</h2>
        <ul>
          <li>
            <div class="home-version">
              <a :href="`${localePrefix}/v2/`">Host API v2</a>
              <span>{{ isEnglish ? "Open to revision" : "改訂可能" }}</span>
            </div>
            <p>{{ isEnglish ? "Read the HTTP contract, Form requirements and implementation guides. The specification may still change." : "HTTP契約、Formの定義要件、実装ガイド。仕様は今後も変更されることがあります。" }}</p>
          </li>
          <li>
            <div class="home-version">
              <a :href="`${localePrefix}/v1/`">Host API v1</a>
              <span>{{ isEnglish ? "Frozen specification" : "固定済み" }}</span>
            </div>
            <p>{{ isEnglish ? "Read the preserved API, common model and schemas for existing v1 implementations." : "既存のv1実装向けのAPI、共通モデル、スキーマ。固定された仕様をそのまま参照できます。" }}</p>
          </li>
        </ul>
      </nav>

      <aside class="home-archive" :aria-label="isEnglish ? 'Reading the documentation' : 'ドキュメントの読み方'">
        <p v-if="isEnglish">
          Specifications are written in English; guides are available in English and Japanese.
          For differences between versions, read <a :href="`${localePrefix}/spec/host-api/v2/migration`">Migration from v1</a>.
        </p>
        <p v-else>
          仕様の原文は英語、ガイドは日本語と英語で読めます。版の違いは
          <a :href="`${localePrefix}/spec/host-api/v2/migration`">v1からの移行案内</a>を参照してください。
        </p>
        <p class="home-related">
          <a :href="`${localePrefix}/reference/`">{{ isEnglish ? "Specification index" : "仕様一覧" }}</a>
          <a :href="`${localePrefix}/site`">{{ isEnglish ? "About this site" : "このサイトについて" }}</a>
        </p>
      </aside>
    </div>
  </main>
</template>

<style src="../home.css"></style>
