<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";

const { lang } = useData();
const isEnglish = computed(() => lang.value === "en");
const localePrefix = computed(() => (isEnglish.value ? "/en" : ""));
const copy = computed(() => isEnglish.value ? {
  introduction: "Takoform describes how clients create, inspect, update and delete resources on a server. A Form defines a kind of resource. A Host is the server that implements it and provides the API.",
  model: "A database and a worker need different settings and expose different ways to use them. Forms describe those differences. The Host API provides a common way to submit changes, follow their progress and handle conflicts or retries.",
  roles: [
    { name: "Form", text: "Defines inputs, outputs, behavior and connections. Its author describes what independent implementations must agree on." },
    { name: "Host", text: "Implements the Forms it supports, runs the resources and manages permissions, persistence and recovery. Its backend may be local or a cloud service." },
    { name: "Client", text: "Chooses a Host and Form, sends the requested configuration and follows the result. It can be an application, CLI or infrastructure provider." },
  ],
  portability: "A shared API gives clients a consistent management protocol. Before using a resource, check that the Host supports the particular Form and review its available capacity, access requirements and terms.",
  exampleIntro: "In this v2 example, a client asks a Host to store a key/value entry. The Form identifies the resource's behavior; spec supplies its configuration.",
  exampleCaption: "Illustrative Host API v2 request. The Host and Form use example domains, not live services.",
  requestLabel: "Create request",
  steps: [
    { name: "Check support", text: "Read the Host's connection and authentication details, then check support for the exact Form URL." },
    { name: "Submit the change", text: "POST the resource request. The Host returns an Operation so the client can follow the accepted change." },
    { name: "Read the result", text: "Follow the Operation to completion, then read the Resource's observed state and output. Acceptance alone does not mean the resource is ready to use." },
    { name: "Update or delete", text: "Use the Resource UID and its current generation. If a response is lost, retry the original request with the same key within the Host's replay window." },
  ],
  exampleLink: "Read the full walkthrough",
  readingIntro: "The guides below use v2. Choose v1 or v2 in the header when reading an existing implementation's API documentation.",
  readings: [
    { path: "/client/", label: "Use the API", text: "Connect a client, send changes and handle their results. For Terraform or OpenTofu, use a provider that supports the chosen API and Forms." },
    { path: "/authoring/", label: "Define a Form", text: "Specify the resource's inputs, observable behavior and usage contract so others can implement it." },
    { path: "/host-api/", label: "Implement a Host", text: "Connect the API to an execution backend and preserve accepted operations through failures and restarts." },
  ],
  scope: "This site documents Takoform's common API and concepts. Individual Form specifications are published by their authors; Hosts and client tools document their own supported features.",
} : {
  introduction: "Takoformは、サーバーが提供するリソースの作成・取得・更新・削除を、共通の手順で扱うための仕様です。リソースの種類ごとの仕様をForm、APIを提供するサーバーをHostと呼びます。",
  model: "データベースとワーカーでは、必要な設定も使い方も異なります。その違いをFormで定義し、変更の要求、進捗の確認、競合や再試行の扱いはHost APIに揃えます。",
  roles: [
    { name: "Form", text: "入力・出力・振る舞い・他のリソースとの接続を定めます。異なる実装でも同じ意味で扱えるよう、作者が仕様を記述します。" },
    { name: "Host", text: "対応するFormを実装し、リソースを提供します。権限、状態の保存、障害からの復旧を担当し、実行先にはローカル環境やクラウドサービスを使えます。" },
    { name: "Client", text: "HostとFormを選び、必要な設定を送って結果を確認します。アプリ、CLI、インフラ管理用のProviderなどがクライアントになります。" },
  ],
  portability: "共通になるのはリソースを管理するための操作方法です。利用するときは、選んだFormにHostが対応しているかを確認し、そのHostの容量、利用条件、必要な権限を確かめます。",
  exampleIntro: "v2でキーと値を保存するリソースを作る例です。formでリソースの仕様を指定し、specに保存したい内容を渡します。",
  exampleCaption: "Host API v2の説明例です。HostとFormには説明用のドメインを使っています。",
  requestLabel: "作成リクエスト",
  steps: [
    { name: "対応するFormを確認する", text: "Hostの接続先と認証方法を調べ、使いたいFormのURLを指定して対応状況を問い合わせます。" },
    { name: "変更を要求する", text: "POSTでリソースの作成を要求します。Hostは受理した変更を追跡するためのOperationを返します。" },
    { name: "結果を読む", text: "Operationの完了後、Resourceから観測した状態と出力を読みます。要求の受理と、実際に使える状態になったことは区別します。" },
    { name: "更新・削除する", text: "ResourceのUIDと現在の世代を指定します。応答が失われた場合は、Hostの再送期限内に同じキーと要求で結果を確認できます。" },
  ],
  exampleLink: "一連の要求と応答を読む",
  readingIntro: "以下のガイドはv2を扱います。既存の実装について調べるときは、ヘッダーから対応するAPIの版を選んでください。",
  readings: [
    { path: "/client/", label: "APIを使う", text: "接続、変更の要求、結果の確認をクライアントへ組み込みます。TerraformやOpenTofuでは、使うAPIとFormに対応したProviderを選びます。" },
    { path: "/authoring/", label: "Formを定義する", text: "リソースの入力、観測できる状態、使い方を、他の人が実装できる仕様として記述します。" },
    { path: "/host-api/", label: "Hostを実装する", text: "APIと実行基盤を接続し、受理した操作を障害や再起動の後も追跡できるようにします。" },
  ],
  scope: "このサイトでは共通APIとTakoformの考え方を説明します。個別Formの仕様は各作者の公開先で、Hostやクライアントの対応機能はそれぞれのドキュメントで確認できます。",
});
const request = `POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 946eec36-4a6a-41de-8f3c-e83d2c58c246

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default",
  "name": "greeting",
  "spec": { "key": "greeting", "value": "hello" }
}`;
</script>

<template>
  <main class="home-page">
    <div class="home-page__inner">
      <header class="home-overview" aria-labelledby="home-title">
        <h1 id="home-title">Takoform</h1>
        <p class="home-overview__lead" lang="en">A common HTTP API for resource management.</p>
        <p class="home-introduction">{{ copy.introduction }}</p>
      </header>

      <section class="home-section home-model" aria-labelledby="home-model-title">
        <h2 id="home-model-title" lang="en">Forms, Hosts and clients</h2>
        <p>{{ copy.model }}</p>
        <dl class="home-roles">
          <div v-for="role in copy.roles" :key="role.name">
            <dt lang="en">{{ role.name }}</dt>
            <dd>{{ role.text }}</dd>
          </div>
        </dl>
        <p>{{ copy.portability }}</p>
      </section>

      <section class="home-section" aria-labelledby="home-example-title">
        <h2 id="home-example-title" lang="en">A resource, from request to result</h2>
        <p>{{ copy.exampleIntro }}</p>
        <div class="home-example">
          <figure>
            <pre tabindex="0" :aria-label="copy.requestLabel"><code>{{ request }}</code></pre>
            <figcaption>{{ copy.exampleCaption }}</figcaption>
          </figure>
          <ol class="home-steps">
            <li v-for="step in copy.steps" :key="step.name">
              <h3>{{ step.name }}</h3>
              <p>{{ step.text }}</p>
            </li>
          </ol>
        </div>
        <a class="home-reading-link" :href="`${localePrefix}/start/`">{{ copy.exampleLink }}</a>
      </section>

      <section class="home-section home-reading" aria-labelledby="home-reading-title">
        <h2 id="home-reading-title" lang="en">Using and implementing Takoform</h2>
        <p>{{ copy.readingIntro }}</p>
        <ul class="home-reading-list">
          <li v-for="reading in copy.readings" :key="reading.path">
            <a class="home-reading-link" :href="`${localePrefix}${reading.path}`">{{ reading.label }}</a>
            <p>{{ reading.text }}</p>
          </li>
        </ul>
        <p class="home-scope">{{ copy.scope }}</p>
      </section>
    </div>
  </main>
</template>

<style src="../home.css"></style>
