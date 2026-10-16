<script setup lang="ts">
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
  exampleIntro: "In this v2 example, a client asks a Host to store a key/value entry. The Form identifies the resource's behavior; spec supplies its configuration.",
  requestLabel: "Request",
  responseLabel: "Response (abridged): the accepted Operation, polled at its Location until it finishes",
  resultLabel: "Result (abridged): the Resource, read after the Operation succeeds",
  steps: [
    { name: "Check support", path: "/start/#discover-support", text: "Read the Host's connection and authentication details, then check support for the exact Form URL." },
    { name: "Submit the change", path: "/start/#create-read", text: "POST the resource request. The Host returns an Operation so the client can follow the accepted change." },
    { name: "Read the result", path: "/start/#create-read", text: "Follow the Operation to completion, then read the Resource. Neither acceptance nor a succeeded Operation alone means the resource is ready to use." },
    { name: "Update or delete", path: "/start/#update", text: "Use the Resource UID and the generation you last read, with a new Idempotency-Key for each change. If a response is lost, resend that exact request with its original key within the Host's replay window." },
  ],
  exampleLink: "Read the full walkthrough",
  readingIntro: "The guides below use v2. Choose v1 or v2 in the header when reading an existing implementation's API documentation.",
  readings: [
    { path: "/use/", label: "Use the API", text: "Check the Host and the exact Form, then call the HTTP API directly or use a tool that explicitly supports v2." },
    { path: "/client/", label: "Build a client", text: "Send changes and handle their results reliably: record intent before sending, replay lost responses safely, follow Operations and handle generation conflicts." },
    { path: "/authoring/", label: "Define a Form", text: "Specify the resource's inputs, observable behavior and usage contract so others can implement it." },
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
        <p>{{ copy.exampleIntro }}</p>
        <div class="home-example">
          <figure>
            <p class="home-example__label">{{ copy.requestLabel }}</p>
            <!-- The request and the Resource scroll on narrow screens, so they take focus. -->
            <pre tabindex="0"><code>{{ request }}</code></pre>
            <p class="home-example__label">{{ copy.responseLabel }}</p>
            <pre><code>{{ response }}</code></pre>
            <p class="home-example__label">{{ copy.resultLabel }}</p>
            <pre tabindex="0"><code>{{ result }}</code></pre>
            <figcaption>
              <code>spec</code> is the accepted desired value and <code>observed</code> is what the Host last checked;
              <code>observedGeneration</code> equals <code>generation</code>, so <code>observed</code> reflects the current generation.
              Illustrative Host API v2 exchanges with other headers, fields and timestamps omitted; the Host and Form use example domains, not live services.
            </figcaption>
          </figure>
          <ol class="home-steps">
            <li v-for="step in copy.steps" :key="step.name">
              <h3><a class="home-step-link" :href="step.path">{{ step.name }}</a></h3>
              <p>{{ step.text }}</p>
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
