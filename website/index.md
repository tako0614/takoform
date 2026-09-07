---
layout: page
title: Takoform
description: リソースの定義、検証、管理APIのための仕様とGoライブラリ。
hero:
  name: Takoform
  text: リソース管理API
  tagline: 設定項目をJSONで定義し、HTTP APIでリソースを作成・更新するための仕様です。定義の検証やAPIの呼び出しに使えるGoライブラリも提供しています。
  actions:
    - theme: brand
      text: はじめる
      link: /start/
    - theme: alt
      text: 仕様を読む
      link: /reference/
features:
  - title: Formを定義する
    details: 設定項目や制約をJSONで記述し、バージョンとダイジェストで識別できるパッケージとして配布します。
    link: /model/
    linkText: データモデル
  - title: パッケージを検証する
    details: Coreライブラリで内容と参照先を検証し、クライアントやHostで使うSnapshotを作成します。
    link: /start/
    linkText: 手元で試す
  - title: Host APIを実装する
    details: リソースの作成・取得・更新・削除と、非同期処理の進捗確認に使うHTTP APIを定めています。
    link: /host-api/
    linkText: APIの概要
---

<HomePage />
