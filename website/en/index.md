---
layout: page
title: Takoform
description: Specifications and Go libraries for resource definitions, verification and management APIs.
hero:
  name: Takoform
  text: Shared definitions for configuration and behavior
  tagline: Define configuration, update and deletion rules, and failure behavior so clients and Hosts can verify and use the same resource contract. Takoform provides the specifications and Go libraries.
  actions:
    - theme: brand
      text: Get started
      link: /en/start/
    - theme: alt
      text: Read the specifications
      link: /en/reference/
features:
  - title: Define a Form
    details: Describe settings and their meaning so Hosts that support the same definition provide the same application-visible behavior.
    link: /en/authoring/
    linkText: Define and verify a Form
  - title: Verify a package
    details: Use Core to verify contents and references, then build a Snapshot for a client or Host.
    link: /en/start/
    linkText: Try it locally
  - title: Use a Host from Go
    details: Discover a Host, check Form availability, prepare a change and create a resource in a runnable Go example.
    link: /en/client/
    linkText: Client example
  - title: Understand the common model
    details: Identify definitions with FormRef, then verify package contents and references in a Snapshot.
    link: /en/model/
    linkText: Data model
  - title: Implement Host API
    details: The HTTP API covers resource creation, reads, updates, deletion and progress tracking for asynchronous operations.
    link: /en/host-api/
    linkText: API overview
---

<HomePage />
