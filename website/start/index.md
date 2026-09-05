---
title: Start
---

# Start: 最初の一周

ここは手元の fixture と report を読むための案内です。fixture は publisher 中立の
synthetic data であり、実在の Form、catalog、稼働中の Host を示しません。

## 0. 準備

repository root で作業します。Go module の依存が取得済みなら、以下の verifier は
network access を使わず、local の fixture と module cache だけを読みます。clone 直後や
module cache が空の場合は、依存を取得するため最初に次を実行します。

```console
go mod download
```

この command は依存を用意するための一回限りの準備です（必要な場合は network access
を使います）。site を見るための bun の install や Host への接続は、この journey には
必要ありません。

## 1. Form Package を verify する（ここは実行する）

一つの package は一つの exact な FormRef と、その Definition、列挙された data-only
payload からなります。次の command は package の閉包、bytes、digest、FormRef を検証し、
JSON report を標準出力へ返します。

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

実行時の出力の要点は次のとおりです（表示は report の抜粋です）。

```json
{
  "packageDigest": "sha256:3af4d09e2939b533a800fba945a85fb7a168ca8fae3454727a028505e38981d7",
  "formRef": {
    "apiVersion": "resources.publisher.example",
    "kind": "CounterReservation",
    "definitionVersion": "0.1.0",
    "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
  },
  "fileCount": 1,
  "payloadBytes": 1689
}
```

`packageDigest` は配布された index の canonical bytes、`schemaDigest` は Definition の
canonical bytesを指します。ここでの group と kind は fixture 専用です。verify に通った
ことは公開、activation、Host support を意味しません。

## 2. immutable Snapshot と generic conformance（ここは実行する）

次の command は、manifest が指定する package、Interface、Binding を検証し、入力順に
依存しない immutable Snapshot を compile します。

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

report には現在、次のような値が入ります。

```json
{
  "format": "takoform.generic-conformance-report@v1",
  "status": "passed",
  "hostApiLane": "forms.takoform.com/v1",
  "manifestDigest": "sha256:7caed449cd40068c0ac940a20e6c5d1fe8555ce4a16812416ea5962d2a243e38",
  "snapshots": [
    { "name": "external-family", "snapshotDigest": "sha256:54f0d997aa1660b07a70dd694713bdd322a9e51774020f70f3d980c8800c360c" },
    { "name": "zero-family", "snapshotDigest": "sha256:591e5ca6da361ba9dc3ca8f091a601ae90ae3cc362b959e37ee23a634a2b2e50" }
  ],
  "checks": [
    { "name": "snapshot-compilation", "status": "passed" },
    { "name": "permutation-stable", "status": "passed" },
    { "name": "no-partial-snapshot", "status": "passed" }
  ]
}
```

これは artifact の conformance です。`snapshot-compilation` は exact な reference
closure と digest を、`permutation-stable` は入力順の独立性を、`no-partial-snapshot` は
失敗時に使える部分 Snapshot を返さないことを確認します。`zero-family` は family が
内蔵されていないことを確認するケースです。この command も network、Host lifecycle、
Resource mutation、runtime code の実行は行いません。

## 3. Host API の transcript（ここは概念。実行しない）

ここからは [Host API v1 wire contract](/spec/host-api/v1) の読み方です。以下は
request / response の形を示す transcript で、実在する endpoint へ送ってはいけません。
この例は Host の稼働、support、activation、backend を証明しません。

まず discovery を読み、`api_versions` と一つの `endpoints.api` を得ます。

```http
GET /.well-known/takoform/v1

HTTP/1.1 200 OK
Content-Type: application/json

{
  "api_versions": ["forms.takoform.com/v1"],
  "features": {
    "service_forms": true,
    "exact_form_ref": true,
    "optimistic_concurrency": true,
    "idempotent_lifecycle": true,
    "operations": true,
    "artifact_upload": true,
    "support_profiles": true
  },
  "endpoints": {
    "api": "https://host.example/apis/forms.takoform.com/v1"
  }
}
```

`https://host.example` は transcript の placeholder です。実際には discovery が返す endpoint と
同じ origin/path を使い、versionless な Form Family group、kind、name から resource address を
組み立てます。

```http
PUT https://host.example/apis/forms.takoform.com/v1/resources/resources.publisher.example/CounterReservation/counter-reservation
If-None-Match: *
Idempotency-Key: create-counter-reservation-20260904
Content-Type: application/json

{
  "apiVersion": "resources.publisher.example",
  "kind": "CounterReservation",
  "form": {
    "formRef": {
      "apiVersion": "resources.publisher.example",
      "kind": "CounterReservation",
      "definitionVersion": "0.1.0",
      "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
    }
  },
  "metadata": { "name": "counter-reservation", "space": "demo" },
  "spec": {
    "target": {
      "apiVersion": "resources.publisher.example",
      "kind": "RangeSequence",
      "name": "range-sequence"
    }
  },
  "review": {
    "prepareDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}

HTTP/1.1 201 Created
```

`review.prepareDigest` の all-`a` 値は transcript 専用の placeholder です。実際には
`prepare` が返す exact な binding をそのまま渡し、client が値を発明することはありません。
そのため、この transcript は実行用 command ではありません。

既存 resource を更新する場合は `If-None-Match: *` の代わりに、その resource の
generation fence を送ります。処理が長い場合の応答は `202 Accepted` となり、返された
operation ID を次のように読みます。

```http
GET https://host.example/apis/forms.takoform.com/v1/operations/op_counter_reservation_create

HTTP/1.1 200 OK
Content-Type: application/json

{
  "apiVersion": "operations.takoform.com/v1alpha1",
  "kind": "Operation",
  "id": "op_counter_reservation_create",
  "done": true,
  "result": {
    "resource": {
      "apiVersion": "resources.publisher.example",
      "kind": "CounterReservation",
      "form": {
        "formRef": {
          "apiVersion": "resources.publisher.example",
          "kind": "CounterReservation",
          "definitionVersion": "0.1.0",
          "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
        }
      },
      "metadata": {
        "name": "counter-reservation",
        "space": "demo",
        "uid": "res_counter_reservation_1",
        "generation": "1",
        "revision": "1"
      },
      "spec": {
        "target": {
          "apiVersion": "resources.publisher.example",
          "kind": "RangeSequence",
          "name": "range-sequence"
        }
      },
      "status": {
        "observedGeneration": "1",
        "conditions": []
      }
    }
  }
}
```

実際の field、status code、fence、error code は [normative な v1 source](/spec/host-api/v1)
と [operation table](/spec/host-api/v1#artifacts-and-operations) を参照してください。ここで示した
placeholder を Form catalog や Host の実装情報として読み替えないでください。

## 次に進む

- [Guides](/guides/) — architect、Core/artifact user、Host/client implementer、
  verifier/reviewer の読み分け。
- [共通モデル](/model/) — identity と Snapshot の data model。
- [Host API v1 とは](/host-api/) — route、fence、error の短い案内。
- [Reference](/reference/) — 英語の normative source と日本語の案内の区別。
