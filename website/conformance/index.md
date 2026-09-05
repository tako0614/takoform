---
title: conformance と参照実装
---

# conformance と参照実装

このページは non-normative な案内です。conformance の主張は、report が名指した artifact または実装
だけに及びます。語彙と requirement keyword の正本は [Conformance language and classes](/spec/conformance)
です。

## claim を分けて読む

- **Form Package data** — 一つの Definition、exact な FormRef、RFC 8785 canonical bytes、
  閉じた file inventory、allowlist された data media type。
- **Interface / Binding data** — digest-bound な ref と Definition schema、canonical bytes、
  closed な operation / capability 語彙。
- **Snapshot artifact** — package index と payload の closure、Interface と Binding の
  digest pin、deterministic な immutable compile。
- **Host protocol** — exact な Host API lane に対する discovery、wire、lifecycle、
  optimistic concurrency、idempotency、identity、relation、artifact、error の証拠。
- **client adapter** — declared desired state だけを送り、exact な FormRef と package
  digest の境界を保つ local projection。
- **publisher trust** — release bytes の provenance、署名、transparency、revocation の
  証拠。

一つの claim から別の claim を導きません。package が検証できても Host Support、activation、
production readiness、商用 Offering が証明されたことにはなりません。

## repository から実行できる harness

[Start の準備](/start/#_0-準備)で依存を取得した後に実行します。以下の検証処理は network を
読まず、Resource を変更しません。

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

一つの package の index、payload closure、FormRef、digest を検証します。

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

generic corpus は package、Interface、Binding、Snapshot の closure、入力順の独立性、
失敗時の no-partial-result を検証します。`external-family` と `zero-family` の二つの
synthetic Snapshot を含みますが、実在の Form catalog や family roster ではありません。

どちらも Host lifecycle の create / read / update / delete、fencing、relation mutation、
runtime code、placement、activation を実行しません。

## report を読むときの確認点

1. `status` が `passed` でも、report の対象が package、Snapshot、Host、client のどれかを
   先に確認する。
2. `FormRef` の `apiVersion`、`kind`、`definitionVersion`、`schemaDigest` が一つの exact
   identity を構成していることを確認する。
3. `packageDigest` は配布 index の証拠で、`schemaDigest` は Definition の証拠であることを
   分けて確認する。
4. Host や publisher の外部操作を主張する場合は、その操作を行った owner の readback を
   別の evidence として要求する。

## source

harness と corpus の source は
[tako0614/takoform](https://github.com/tako0614/takoform) にあります。

```console
git clone https://github.com/tako0614/takoform.git
cd takoform
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

OpenTofu / Provider の検証は [terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform)
の project と report を参照してください。この page はその内容を複製しません。

## 次に読む

- [Start](/start/) — 実行 command と概念 Host API transcript。
- [Host API v1 とは](/host-api/) — route、fence、error の案内。
- [Reference](/reference/) — English / normative source と Japanese guide の区別。
