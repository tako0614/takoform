<script setup lang="ts">
import { codeLineSegments } from "../../code-wrap.mjs";

const copy = {
  introduction: "Takoform describes how clients create, inspect, update and delete resources on a server. A Form defines a kind of resource. A Host is the server that implements it and provides the API.",
  actions: [
    { path: "/start/", label: "Walk through the v2 API", primary: true },
    { path: "/guides/", label: "Guides by role", primary: false },
  ],
  model: "A database and a worker need different settings and expose different ways to use them. Forms describe those differences. The Host API provides a common way to submit changes, follow their progress and handle conflicts or retries.",
  roles: [
    { name: "Form", text: "Defines inputs, outputs, behavior and connections. Its author describes what independent implementations must agree on." },
    { name: "Host", text: "Implements the Forms it supports, runs the resources and manages permissions, persistence and recovery. Its backend may be local or a cloud service." },
    { name: "Client", text: "Chooses a Host and Form, sends the requested configuration and follows the result. It can be an application, CLI or infrastructure provider." },
  ],
  portability: "A shared API gives clients a consistent management protocol. Before using a resource, check that the Host supports the particular Form and review its available capacity, access requirements and terms.",
  // A [term, href] pair, here and in `steps`, renders as a link to the term's glossary entry, for a reader who meets it here first.
  exampleIntro: [
    "In this v2 example, a client asks a Host to store a key/value entry. The Form identifies the resource's behavior and spec supplies its configuration. The name must be unique within its ",
    ["Space", "/glossary#space"], ", a Resource scope on the Host. The Host accepts the request and answers with an ",
    ["Operation", "/glossary#operation"], " whose ", ["status and effect", "/glossary#status-effect"],
    " report its progress and what is known to have changed so far.",
  ],
  requestLabel: "Request",
  responseLabel: "Response (abridged): the accepted Operation, which the client polls until it finishes",
  resultLabel: "Result (abridged): the Resource, read after the Operation succeeds",
  steps: [
    { name: "Check support", path: "/start/#discover-support", text: "Read the Host's connection and authentication details, then check support for the exact Form URL." },
    { name: "Submit the change", path: "/start/#create-read", text: "POST the resource request. The Host returns an Operation so the client can follow the accepted change." },
    { name: "Read the result", path: "/start/#create-read", text: "Follow the Operation to completion, then read the Resource. Neither acceptance nor a succeeded Operation alone means the resource is ready to use." },
    { name: "Update or delete", path: "/start/#update", text: [
      "Use the ", ["Resource UID", "/glossary#uid"], " and the ", ["generation", "/glossary#generation-observedgeneration"],
      " you last read, with a new ", ["Idempotency-Key", "/glossary#idempotency-key"],
      " for each change. If a response is lost, resend that exact request with its original key within the Host's ",
      ["replay window", "/glossary#replay-window"], ".",
    ] },
  ],
  exampleLink: "Read the full walkthrough",
  readingIntro: "The guides below use v2. Choose v1 or v2 in the header when reading an existing implementation's API documentation.",
  readings: [
    { path: "/use/", label: "Use the API", text: "Check the Host and the exact Form, then call the HTTP API directly or use a tool that explicitly supports v2." },
    { path: "/client/", label: "Implement a client", text: "Send changes and handle their results reliably: record intent before sending, replay lost responses safely, follow Operations and handle generation conflicts." },
    { path: "/authoring/", label: "Create a Form", text: "Specify the resource's inputs, observable behavior and usage contract so others can implement it." },
    { path: "/host-api/", label: "Implement a Host", text: "Connect the API to an execution backend, preserve accepted operations through failures and restarts, then check your Host against the baseline probe." },
  ],
  scope: "This site documents Takoform's common API and concepts. Individual Form specifications are published by their authors; Hosts and client tools document their own supported features.",
};
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
const response = `HTTP/1.1 202 Accepted
Retry-After: 1

{
  "id": "op_create_1",
  "resourceUid": "r_1",
  "action": "create",
  "generation": 1,
  "status": "queued",
  "effect": "none"
}`;
const result = `GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1

HTTP/1.1 200 OK

{
  "uid": "r_1",
  "generation": 1,
  "observedGeneration": 1,
  "spec": { "key": "greeting", "value": "hello" },
  "observed": {
    "entryExists": true, "key": "greeting", "value": "hello"
  }
}`;

// The example wraps like highlighted code (code-wrap.mjs): each line hangs
// under its own indentation, keeps its indentation with its first character,
// and may wrap at <wbr> hints. The text is unchanged.
const examples = [
  { label: copy.requestLabel, lines: codeLineSegments(request) },
  { label: copy.responseLabel, lines: codeLineSegments(response) },
  { label: copy.resultLabel, lines: codeLineSegments(result) },
];
</script>

<template>
  <main class="home-page">
    <div class="home-page__inner">
      <header class="home-overview" aria-labelledby="home-title">
        <h1 id="home-title">Takoform</h1>
        <p class="home-overview__lead" lang="en">A common HTTP API for resource management.</p>
        <p class="home-introduction">{{ copy.introduction }}</p>
        <ul class="home-actions">
          <li v-for="action in copy.actions" :key="action.path">
            <a
              class="home-action"
              :class="{ 'home-action--primary': action.primary }"
              :href="action.path"
            >{{ action.label }}</a>
          </li>
        </ul>
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
        <p>
          <template v-for="(part, index) in copy.exampleIntro" :key="index">
            <a v-if="Array.isArray(part)" class="home-term-link" :href="part[1]">{{ part[0] }}</a>
            <template v-else>{{ part }}</template>
          </template>
        </p>
        <div class="home-example">
          <figure>
            <template v-for="example in examples" :key="example.label">
              <p class="home-example__label">{{ example.label }}</p>
              <pre class="takoform-wrap"><code><template v-for="(line, i) in example.lines" :key="i"><span class="line" :style="line.style"><template v-for="(segment, k) in line.segments" :key="k"><wbr v-if="segment.hint"><span v-if="segment.keep" class="takoform-keep">{{ segment.text }}</span><template v-else>{{ segment.text }}</template></template></span><template v-if="i < example.lines.length - 1">{{ "\n" }}</template></template></code></pre>
            </template>
            <figcaption>
              <code>spec</code> is the accepted desired value and <code>observed</code> is what the Host last checked;
              <code>observedGeneration</code> equals <code>generation</code>, so the Host has confirmed the current generation as realized.
              Illustrative Host API v2 exchanges with other headers, fields and timestamps omitted; the Host and Form use example domains, not live services.
            </figcaption>
          </figure>
          <ol class="home-steps">
            <li v-for="step in copy.steps" :key="step.name">
              <h3><a class="home-step-link" :href="step.path">{{ step.name }}</a></h3>
              <p>
                <template v-for="(part, index) in Array.isArray(step.text) ? step.text : [step.text]" :key="index">
                  <a v-if="Array.isArray(part)" class="home-term-link" :href="part[1]">{{ part[0] }}</a>
                  <template v-else>{{ part }}</template>
                </template>
              </p>
            </li>
          </ol>
        </div>
        <a class="home-reading-link" href="/start/">{{ copy.exampleLink }}</a>
      </section>

      <section class="home-section home-reading" aria-labelledby="home-reading-title">
        <h2 id="home-reading-title" lang="en">Using and implementing Takoform</h2>
        <p>{{ copy.readingIntro }}</p>
        <ul class="home-reading-list">
          <li v-for="reading in copy.readings" :key="reading.path">
            <a class="home-reading-link" :href="reading.path">{{ reading.label }}</a>
            <p>{{ reading.text }}</p>
          </li>
        </ul>
        <p class="home-scope">{{ copy.scope }}</p>
      </section>
    </div>
  </main>
</template>

<style src="../home.css"></style>
