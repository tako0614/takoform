---
title: Implementing a v2 client
description: 操作意図と再送期限を保存し、Operation・generation・認証変化に応じて再開するクライアントの設計を説明します。
---

# Implementing a v2 client {#client}

クライアントはHostのDiscoveryから`baseUrl`（APIの接続先）、認証案内、`replayWindowSeconds`を読み、Form URLで指定された仕様に従って要求を作ります。Formへの`support`確認、Spaceの利用権限、操作の成功はそれぞれ別に確かめます。

## 送信前に操作意図を記録する {#intent}

クライアントが再起動や応答喪失を越えて同じ操作を識別するには、要求を送る前に一つの操作意図（intent）の記録を保存します。最低限、次を一緒に保持します。

- Hostの接続元（origin）とAPI version、Form URL、Space、Resource nameまたはUID。
- HTTP method、API rootからの相対pathとquery、要求全体（Updateなら世代条件と完全な`spec`を含む）。
- この操作意図専用に生成したIdempotency-Keyと初回送信時刻。
- Discoveryから読んだ再送可能期間（replay window）。再送のたびに初回送信時刻を更新しません。
- 応答後に得たOperation ID、Resource UID、受理generation、`Location`、`retainUntil`。

認証情報そのものは操作意図の記録へ複製せず、クライアントの認証管理に委ねます。Formが`privateInputs`（秘匿入力）を使う場合、その値を通常ログや公開状態へ書かず、HTTP契約の秘密情報の取扱いに従ってください。

Idempotency-Keyは「要求本文が同じなら再利用してよいキー」ではなく、「同じ操作意図を再送する間だけ使うキー」です。新しい希望値や別の変更には、同じResourceでも別のキーを発行します。

## 結果ごとの次の判断 {#decisions}

| 結果 | クライアントの処理 |
| --- | --- |
| `202 Accepted` | `Retry-After`を待ち、`Location`またはOperation IDをGETします。Operationが完了状態になるまで同じOperationを追跡し、その後Resourceを読みます。新しい変更要求は作りません。 |
| 応答喪失・期限内 | 初回に保存したmethod、path/query、本文、keyをそのまま再送します。変更した本文や新しいkeyは使いません。再送への応答では元のOperationが返ります。 |
| Operationが`reconciling` / `effect: unknown` | UIDとOperation IDを未解決として保持し、Operationの状態を照合します。Hostが元の実行先を特定して結果を解決するまで、そのUIDへ別の変更要求を送りません。GETは復旧処理の起動にはなりません。 |
| `409 generation_conflict` | この要求は未受理でOperationはありません。最新ResourceをGETし、他の変更を踏まえて次の操作を判断します。続ける場合は最新generationと新しいkeyで別の操作意図を作ります。 |
| 再送期限が近い / 経過した | `初回送信時刻 + replayWindowSeconds`より前に自動再送を止めます。既知のOperation IDをGETし、Resourceやlistの結果を照合します。受理の有無が分からない状態で、同じkeyにも別keyにも盲目的に再送しません。 |

Resourceの`generation`、`observedGeneration`、`observedAt`を記録し、Operationの状態と混同しません。Operationの成功はFormが定めた管理操作の完了を示しますが、サービス全体の稼働状態を保証するものではありません。

## 認証が変わったとき {#auth-change}

Hostは各要求を認証・認可します。認証情報の更新後も同じ認証主体（principal。権限や再送記録を適用する単位）として扱われるか、権限が維持されたかはHostの認証文書に従います。別の認証主体の認証情報は、異なるIdempotency-Keyの適用範囲になります。以前の認証主体で受理された要求を、新しい認証主体のkeyで「再送」してはいけません。

権限を失った場合、Hostは既存Operationを明かさず`403`または`404`を返せます。アクセスを回復して元の認証主体で照会できるまで、結果不明の操作意図を破棄したり別keyで作り直したりせず、利用者またはHost運営者と結果の照合方法を決めます。

## HTTP契約へ戻る {#http-contract}

status、再送の適用範囲と保持期間は[HTTP APIの再送契約](/spec/host-api/v2/http#retry)、世代競合は[Update](/spec/host-api/v2/http#update)と[エラー](/spec/host-api/v2/http#errors)を参照してください。要求から応答までの値と流れは[説明用例](/spec/host-api/v2/examples)にあります。
