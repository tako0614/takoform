---
title: はじめる
---

# はじめる

テスト用のパッケージを検証し、Snapshotを作成します。後半ではHost APIの要求・応答例を
説明します。ここで使うのは架空のFormのテストデータです。Hostへの接続やリソースの作成は行いません。

## 0. 準備

Takoformリポジトリのルートで作業します。最初にGoの依存モジュールを取得してください。
取得済みであれば、この手順の検証コマンドはネットワーク接続なしで実行できます。

```console
go mod download
```

この準備にはネットワーク接続が必要な場合があります。BunやHostへの接続は不要です。

## 1. パッケージを検証する

Form Packageは、一つのFormRef、その定義、収録ファイルからなります。
次のコマンドで、必要なファイルが揃っていること、内容とダイジェスト、FormRefの一致を
検証します。結果はJSONで標準出力に表示されます。

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

出力の抜粋です。

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

`packageDigest` は正規化したパッケージ索引、`schemaDigest` は正規化した定義の内容を指します。
この例の名前空間とkindはテスト専用です。検証に成功しても、公開されていることや
Hostで利用できることを確認したわけではありません。

## 2. Snapshotを作成して検証する

次のコマンドは、マニフェストが指定するパッケージ、Interface、Bindingを検証し、
入力順に依存しない、変更不可のSnapshotを構築します。

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

検証レポートの抜粋です。

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

`snapshot-compilation` は参照先とダイジェストの一致、`permutation-stable` は入力順に
よらず結果が同じになること、`no-partial-snapshot` は失敗時に不完全なSnapshotを返さない
ことを確認します。`zero-family` は特定のForm Familyが組み込まれていないことを確認します。
この検証も、ネットワーク接続、Host上の操作、リソースの変更、実行コードの起動は行いません。

## 3. Host APIの要求・応答例を読む

ここからは [Host API v1](/spec/host-api/v1) の通信例です。実行するコマンドではありません。
架空の接続先と応答を使って、要求・応答の形式を示します。

まず接続先の情報を取得します。対応APIバージョンは `api_versions`、APIの接続先は
`endpoints.api` に返ります。

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

`https://host.example` は説明用の仮のURLです。実際には取得したAPI接続先をそのまま使い、
Form Familyの名前空間、kind、リソース名を加えて操作先のURLを組み立てます。
Form Familyの名前空間にはバージョンを含めません。

この例では、同じspaceに参照先の `RangeSequence` が既にあり、呼び出し元が作成を許可されているものとします。まず正確なFormRefへの対応と許可を確認します。

```http
GET https://host.example/apis/forms.takoform.com/v1/forms?group=resources.publisher.example&kind=CounterReservation&definitionVersion=0.1.0&schemaDigest=sha256%3A9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116&space=demo

HTTP/1.1 200 OK
Content-Type: application/json

{
  "forms": [
    {
      "identity": {
        "formRef": {
          "apiVersion": "resources.publisher.example",
          "kind": "CounterReservation",
          "definitionVersion": "0.1.0",
          "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
        }
      },
      "definitionKnown": true,
      "installed": true,
      "executable": true,
      "activated": true,
      "availableToPrincipal": true,
      "operations": [
        "create",
        "read",
        "delete",
        "import",
        "observe"
      ]
    }
  ]
}
```

次に、作成する内容を `prepare` に送ります。Hostは内容を事前確認し、同じ内容のResourceと `review` を返します。この要求だけではリソースを作成しません。

```http
POST https://host.example/apis/forms.takoform.com/v1/resources/prepare
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
  "metadata": {
    "name": "counter-reservation",
    "space": "demo"
  },
  "spec": {
    "target": {
      "apiVersion": "resources.publisher.example",
      "kind": "RangeSequence",
      "name": "range-sequence"
    }
  }
}

HTTP/1.1 200 OK
Content-Type: application/json

{
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
      "space": "demo"
    },
    "spec": {
      "target": {
        "apiVersion": "resources.publisher.example",
        "kind": "RangeSequence",
        "name": "range-sequence"
      }
    }
  },
  "review": {
    "prepareDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "specDigest": "sha256:2bf6bf2dbd6249a80082f45aebf696ebcf93c52a457a4a9234f18a29ed219e25"
  }
}
```

応答の `review.prepareDigest` を、内容を変えずにapplyへ渡します。以下の `a` の列は説明用の仮の値です。実Hostでは応答をそのまま使い、クライアントで生成しません。新規作成は `If-None-Match: *` で既存リソースの上書きを防ぎます。同期で完了すると、作成済みResource全体が返ります。

```http
PUT https://host.example/apis/forms.takoform.com/v1/resources/resources.publisher.example/CounterReservation/counter-reservation
If-None-Match: *
Idempotency-Key: create-counter-reservation-20260907
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
  "metadata": {
    "name": "counter-reservation",
    "space": "demo"
  },
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
Content-Type: application/json
ETag: "1"

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
    "conditions": [
      {
        "type": "Ready",
        "status": "True",
        "reason": "Available",
        "lastTransitionTime": "2026-09-07T00:00:00Z"
      }
    ]
  }
}
```

時間のかかる処理では、上の `201 Created` の代わりに、次の `202 Accepted` が返ります。これは別の処理分岐であり、201の後に202が返るわけではありません。

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "operation": {
    "apiVersion": "operations.takoform.com/v1alpha1",
    "kind": "Operation",
    "id": "op_counter_reservation_create",
    "done": false
  }
}
```

返されたOperationのIDで結果を取得します。`done: false` の間はHostの再試行案内に従って確認し、完了後は成功したResourceまたはエラーを読み取ります。下は成功して完了した応答です。

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
        "conditions": [
          {
            "type": "Ready",
            "status": "True",
            "reason": "Available",
            "lastTransitionTime": "2026-09-07T00:00:00Z"
          }
        ]
      }
    }
  }
}
```

更新では、読み取ったUIDとgenerationを使って同時更新を制御します。ただし、この `CounterReservation` の定義は更新操作を持ちません。更新可能かどうかもFormの定義とHostの対応情報で確認してください。Goで実際の呼び出し順を試す例は [GoからHostを使う](/client/) にあります。

各フィールド、ステータスコード、同時更新の制御、エラーコードの詳細は
[Host API v1の仕様](/spec/host-api/v1) と
[操作の一覧](/spec/host-api/v1#artifacts-and-operations) を参照してください。

## 次に進む

- [実装ガイド](/guides/) — 作りたいものに応じた関連仕様。
- [共通モデル](/model/) — 識別子、パッケージ、Snapshotの関係。
- [Host APIの概要](/host-api/) — 接続先と主な操作。
- [仕様一覧](/reference/) — 実装の基準となる仕様と日本語の解説。
