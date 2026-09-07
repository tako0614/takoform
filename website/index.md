---
layout: page
title: Takoform
description: リソースの定義、検証、管理APIのための仕様とGoライブラリ。
hero:
  name: Takoform
  text: リソースの共通仕様
  tagline: 設定・更新・削除・失敗時の扱いを定義し、クライアントとHostで同じ内容を検証・利用するための仕様とGoライブラリです。
  actions:
    - theme: brand
      text: はじめる
      link: /start/
    - theme: alt
      text: 仕様を読む
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
