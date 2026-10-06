---
title: Using v2
description: Understand how API clients and Infrastructure as Code tools can use Host API v2, and what support to verify.
---

# Using v2 {#use}

Host API v2 is an HTTP contract that client software can call when it implements v2. A command-line tool, library, or Infrastructure as Code integration may act as that client. This repository documents the protocol; it does not own or certify those client adapters. Check the selected Host, Form, and client for actual support.

## What a client must do {#client-responsibilities}

A client reads the Host's Discovery response for its `baseUrl` and authentication scheme. It builds requests from a Form URL and complete `spec`, chooses a Space it is authorized to use, and follows the resulting Operation. Update/Delete requests carry the Resource generation that was read; after a change, the client checks `observedGeneration`. See the [client guide](/client/) and [illustrative examples](/spec/host-api/v2/examples).

## Infrastructure as Code {#infrastructure-as-code}

An IaC provider must keep its state consistent with v2's generation conditions, Operations, reconciliation after lost responses, and deletion outcomes—not just compare declared and remote values. Before using Terraform or OpenTofu, verify that the provider explicitly supports Host API v2 and the selected Host and Form URL.

The existing Takoform Provider linked from this site targets v1. Do not treat it as a v2 Provider. For the earlier provider path, see the [v1 specification](/spec/host-api/v1) and the [Provider's v1 guide](https://github.com/tako0614/terraform-provider-takoform).

## Examples and implementation status {#examples-status}

The [v2 request/response examples](/spec/host-api/v2/examples) are non-normative and use a fictional Host and Form. They are not production endpoints or a provider. Before use, check the Host operator's authentication, access, and Form support information, plus the version-specific support statement for each client.
