---
layout: page
title: Takoform
description: リソースの定義、検証、管理APIのための仕様とGoライブラリ。
hero:
  name: Takoform
  text: 設定と振る舞いを、共通の定義に
  tagline: リソースの設定項目だけでなく、更新・削除・失敗時の扱いまで定義し、クライアントとHostが同じ内容を検証・利用するための仕様とGoライブラリです。
  actions:
    - theme: brand
      text: はじめる
      link: /start/
    - theme: alt
      text: 仕様を読む
      link: /reference/
features:
  - title: Formを定義する
    details: 設定とその意味を記述し、同じ定義に対応するHostでアプリケーションから見た振る舞いを揃えます。
    link: /authoring/
    linkText: 定義から検証まで試す
  - title: パッケージを検証する
    details: Coreライブラリで内容と参照先を検証し、クライアントやHostで使うSnapshotを作成します。
    link: /start/
    linkText: 手元で試す
  - title: GoからHostを使う
    details: 接続先を確認し、Formへの対応確認、変更の事前確認、リソースの作成までをGoで試します。
    link: /client/
    linkText: クライアントの実行例
  - title: 共通モデルを理解する
    details: FormRefで定義を特定し、パッケージとSnapshotで内容と参照先を検証する仕組みを説明します。
    link: /model/
    linkText: データモデル
  - title: Host APIを実装する
    details: リソースの作成・取得・更新・削除と、非同期処理の進捗確認に使うHTTP APIを定めています。
    link: /host-api/
    linkText: APIの概要
---

<HomePage />
