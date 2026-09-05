<template>
  <main class="tf-home">
    <header class="tf-hero tf-shell">
      <p class="tf-kicker">PORTABLE RESOURCE CONTRACT</p>
      <h1>リソースの契約を、<br />実装から切り離す。</h1>
      <p class="tf-hero-lede">
        Publisher が公開した contract を、Core、Client、Host が同じ exact な bytes として扱う。
        Takoform は、その間にあるデータと wire の境界を定義します。
      </p>
      <div class="tf-actions" aria-label="はじめる">
        <a class="tf-action tf-action--primary" href="/start/">
          仕組みをつかむ
          <span aria-hidden="true">→</span>
        </a>
        <a class="tf-action tf-action--quiet" href="/reference/">
          仕様を調べる
        </a>
      </div>
      <dl class="tf-hero-scope" aria-label="Takoformの範囲">
        <div>
          <dt>Takoform が決める</dt>
          <dd>portable な identity、package、Snapshot、Host API</dd>
        </div>
        <div>
          <dt>各 owner が決める</dt>
          <dd>Form の内容、OpenTofu への写像、Host の実装と運用</dd>
        </div>
      </dl>
    </header>

    <section class="tf-section tf-section--map" aria-labelledby="contract-map-title">
      <div class="tf-shell">
        <div class="tf-section-heading">
          <p class="tf-kicker">CONTRACT MAP</p>
          <h2 id="contract-map-title">一つの契約が届くまで</h2>
          <p>
            Publisher から Host まで、契約の検証と実行の責任を順に追えます。
          </p>
        </div>

        <figure class="tf-contract-map" aria-describedby="contract-map-caption">
          <ol class="tf-contract-flow">
            <li class="tf-contract-stage tf-contract-stage--external">
              <p class="tf-stage-owner">FORM OWNER</p>
              <h3>Publisher</h3>
              <p>Definition と data-only package を公開する。</p>
              <a href="/spec/form-package/">package の契約 <span aria-hidden="true">→</span></a>
            </li>
            <li class="tf-contract-stage tf-contract-stage--core">
              <p class="tf-stage-owner">TAKOFORM</p>
              <h3>Core</h3>
              <p>package を検証し、immutable な Snapshot へ compile する。</p>
              <a href="/model/">共通モデル <span aria-hidden="true">→</span></a>
            </li>
            <li class="tf-contract-stage tf-contract-stage--external">
              <p class="tf-stage-owner">CLIENT OWNER</p>
              <h3>Client / OpenTofu</h3>
              <p>exact な FormRef を使う。Provider の schema と state は別 owner が持つ。</p>
              <a href="/guides/#host-client-implementer">Client 側の読む順番 <span aria-hidden="true">→</span></a>
            </li>
            <li class="tf-contract-stage tf-contract-stage--core">
              <p class="tf-stage-owner">TAKOFORM</p>
              <h3>Host API v1</h3>
              <p>discovery、lifecycle、Operation、fence、error の wire を固定する。</p>
              <a href="/host-api/">wire の入口 <span aria-hidden="true">→</span></a>
            </li>
            <li class="tf-contract-stage tf-contract-stage--external">
              <p class="tf-stage-owner">HOST OWNER</p>
              <h3>Host</h3>
              <p>契約を support し、実際の resource と運用状態を所有する。</p>
              <a href="/guides/#host-client-implementer">Host 側の読む順番 <span aria-hidden="true">→</span></a>
            </li>
          </ol>
          <figcaption id="contract-map-caption">
            Takoform は中央 catalog でも resource manager でもありません。中立な契約と検証可能な境界だけを所有します。
          </figcaption>
        </figure>
      </div>
    </section>

    <section class="tf-section tf-shell" aria-labelledby="role-title">
      <div class="tf-section-heading tf-section-heading--split">
        <div>
          <h2 id="role-title">目的から、そのまま読む</h2>
        </div>
        <p>
          同じ文書体系の中で、概要から normative source まで段階的に深くなります。
        </p>
      </div>

      <ol class="tf-role-index">
        <li>
          <span class="tf-role-number" aria-hidden="true">01</span>
          <div>
            <h3>初めて仕組みを理解する</h3>
            <p>一つの synthetic package を検証し、identity と所有境界をつかむ。</p>
          </div>
          <a href="/start/">Start <span aria-hidden="true">→</span></a>
        </li>
        <li>
          <span class="tf-role-number" aria-hidden="true">02</span>
          <div>
            <h3>Form を公開する</h3>
            <p>Definition、package closure、trust と publisher の責任を確認する。</p>
          </div>
          <a href="/spec/form-package/">Package contract <span aria-hidden="true">→</span></a>
        </li>
        <li>
          <span class="tf-role-number" aria-hidden="true">03</span>
          <div>
            <h3>Client / Provider を作る</h3>
            <p>Snapshot を typed projection に変え、Host API を exact に呼ぶ。</p>
          </div>
          <a href="/guides/#host-client-implementer">Client guide <span aria-hidden="true">→</span></a>
        </li>
        <li>
          <span class="tf-role-number" aria-hidden="true">04</span>
          <div>
            <h3>Host を実装・検証する</h3>
            <p>discovery、lifecycle、fence、error と conformance class をたどる。</p>
          </div>
          <a href="/conformance/">Conformance <span aria-hidden="true">→</span></a>
        </li>
      </ol>
    </section>

    <section class="tf-section tf-section--boundary" aria-labelledby="boundary-title">
      <div class="tf-shell tf-boundary">
        <div class="tf-section-heading">
          <h2 id="boundary-title">便利さは、正しい owner の上に置く</h2>
        </div>
        <div class="tf-boundary-copy">
          <p>
            Takoform は OpenTofu を隠しません。Provider が使いやすい UI や入力を提供しても、
            FormRef、Snapshot、Provider schema、state、Host の authority は混ぜません。
            だから入口を単純にしても、詳細を失わずに調べられます。
          </p>
          <nav class="tf-text-links" aria-label="所有境界を調べる">
            <a href="/model/">共通モデル <span aria-hidden="true">↗</span></a>
            <a href="/reference/">Reference index <span aria-hidden="true">↗</span></a>
            <a href="/site">このsiteの所有範囲 <span aria-hidden="true">↗</span></a>
          </nav>
        </div>
      </div>
    </section>
  </main>
</template>
