---
title: Using v2
description: APIクライアントやInfrastructure as CodeからHost API v2を利用するときの境界を説明します。
---

# Using v2 {#use}

Host API v2はHTTP契約です。CLI、SDK、Infrastructure as Code providerなど、どの種類のクライアントからでも利用できますが、そのソフトウェアがv2を実装していることが前提です。このサイトは特定のHost、Provider、公開Formの利用可能性を保証しません。

## クライアントに必要な処理 {#client-responsibilities}

クライアントはHostのDiscoveryから`baseUrl`と認証方法を読みます。Form URLと完全な`spec`に基づいて要求を作り、認可済みSpaceを選び、Operationを追跡します。Update/Deleteには読み取ったgenerationを付け、変更後はResourceの`observedGeneration`を確認します。詳細は[クライアントガイド](/client/)と[説明用例](/spec/host-api/v2/examples)を参照してください。

## Infrastructure as Code {#infrastructure-as-code}

IaCのproviderは、Resourceを宣言状態と実状態の差分として扱うだけでなく、APIの世代条件、Operation、応答喪失後の照合、削除結果もstateと一貫させる必要があります。Terraform/OpenTofuで利用するには、対象providerがHost API v2を明示的にサポートし、使うHostとForm URLにも対応しているかを確認してください。

このサイトに案内されている既存Takoform Providerはv1向けです。v2対応Providerとして扱わないでください。従来のprovider経路を調べる場合は[v1仕様](/spec/host-api/v1)と[Providerのv1案内](https://github.com/tako0614/terraform-provider-takoform)を参照してください。

## 例と実装状況 {#examples-status}

[v2要求・応答例](/spec/host-api/v2/examples)は架空のHostとFormを使う非規範の説明です。実運用のendpointやproviderではありません。利用前にHost運営者の認証・アクセス・Form対応の案内と、各クライアントのversioned supportを確認してください。
