---
title: conformance と参照実装
---

# conformance と参照実装

conformance の主張は、report が名指した artifact または実装だけに及びます。normative な
語彙と class は [Conformance language and classes](/spec/conformance) が持ちます。

## 独立した主張

- **Form Package data** — Definition 一つ、exact な FormRef 一つ、RFC 8785 canonical bytes、
  閉じた file inventory、allowlist された data media type。Host に依存せず valid です。
- **Interface / Binding data** — digest 束縛の ref と Definition schema、canonical bytes、
  閉じた operation / capability 語彙。identity を決めるのは digest であって内蔵 catalog では
  ありません。
- **Snapshot artifact** — package index と payload の closure、digest、exact な Form
  identity、Interface と Binding の bytes と digest pin、deterministic な compile。
- **Host protocol** — exact な Host API lane に対する実装の主張。discovery、wire、lifecycle、
  optimistic concurrency、idempotency、identity、relation、artifact、error の規則を、その Host
  自身の証拠で覆う必要があります。
- **client adapter** — 宣言された desired state だけを送り、exact な FormRef と package digest の
  境界を保ち、占有された identity や migration を運べないときに fail closed する。
- **publisher trust** — release した bytes を immutable に保ち、exact な digest と provenance を
  記録し、append-only な revocation policy を使う。

## 参照 harness

このrepositoryから動かせる参照検証器です。network を読まず、Resource を変更しません。

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

```console
go run ./cmd/form-package verify <package-directory>
```

```console
go run ./cmd/takoform-trust --help
```

generic corpus は意図的に family 中立です。synthetic な reverse-DNS group を使い、family
package が零個でも通ります。roster も優遇される namespace もありません。

## 通っても言えないこと

package と contract と Snapshot の検査に通ることが証明するのは、その data と compiler の
性質だけです。動いている Host、lifecycle の実行、fencing、Host support、production の
activation、revocation の強制、特定 backend との相互運用性は、どれも別の証拠です。
外部の操作を実際に行った当事者からの readback が要ります。

corpus は Host の lifecycle runner ではありません。create / read / update / delete、
optimistic concurrency の fencing、relation の変更、runtime code、activation、Host Support、
各 publisher の family 意味論を実行しません。

## 実行する source

harness と corpus は
[tako0614/takoform](https://github.com/tako0614/takoform) にあります。

```console
git clone https://github.com/tako0614/takoform.git
cd takoform
bun install --frozen-lockfile
bun run check
```
