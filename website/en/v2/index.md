# Host API v2 Specification

Takoform provides a shared HTTP API to create, read, update, and delete resources.
Authors publish Forms that define what each resource means. Hosts implement the
Forms they support, and clients operate resources according to those specifications.

These pages contain the v2 specification text, ahead of its formal publication.
The v2 specification pages linked below are currently written in Japanese; the English routes preserve the source and label its language.

## Specification

- [Overview and basic concepts](/en/spec/host-api/v2/)
- [HTTP API requests and responses](/en/spec/host-api/v2/http)
- [Defining a Form, with a complete example](/en/spec/host-api/v2/forms)
- [End-to-end examples](/en/spec/host-api/v2/examples)
- [Migration from v1](/en/spec/host-api/v2/migration)

## Suggested reading order

- Form authors: start with [Form requirements](/en/spec/host-api/v2/forms), then consult the [examples](/en/spec/host-api/v2/examples).
- Host implementers: read the [overview](/en/spec/host-api/v2/), then the [HTTP API](/en/spec/host-api/v2/http) and [Form requirements](/en/spec/host-api/v2/forms).
- Client implementers: follow the [examples](/en/spec/host-api/v2/examples), then use the [HTTP API](/en/spec/host-api/v2/http) to look up request and response details.
- Existing v1 users: read [Migration](/en/spec/host-api/v2/migration) for the changes and questions to resolve when carrying resources forward.
