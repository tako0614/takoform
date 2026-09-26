---
layout: page
title: Takoform
description: Formの共通モデルと、リソースを管理するHost APIの仕様・Goライブラリ。
hero:
  name: Takoform
  text: Formの共通モデルとHost API
  tagline: リソースの設定や振る舞いをFormで表し、対応するHostを共通のAPIから操作できます。このサイトではFormに共通するモデルとHost APIを説明します。
  actions:
    - theme: brand
      text: はじめる
      link: /start/
    - theme: alt
      text: Host API v1を読む
      link: /host-api/
    - theme: alt
      text: 仕様一覧を読む
      link: /reference/
features:
  - title: Formを定義する
    details: 設定と振る舞いをJSONで定義し、パッケージを作成・検証します。
    link: /authoring/
    linkText: 定義から検証まで試す
  - title: パッケージを検証する
    details: 定義と参照先の一致を確かめ、検証済みのSnapshotとして利用します。
    link: /model/
    linkText: 検証の仕組み
  - title: GoからHostを使う
    details: 接続先とFormへの対応を確認し、prepareからapplyまでを実行します。
    link: /client/
    linkText: クライアントの実行例
  - title: Host APIを実装する
    details: リソース操作、同時更新の制御、非同期処理を扱うAPIを実装します。
    link: /host-api/
    linkText: APIの概要
---

<HomePage />
