# Proposals and historical design notes

This non-normative index records ideas under review and retained proposals.
A proposal is not an implemented API or a published contract. The fixed Host
API v2 contract lives in [its specification](../host-api/v2/README.md), with
separate [HTTP rules](../host-api/v2/http.md), [Form requirements](../host-api/v2/forms.md)
and explanatory [examples](../host-api/v2/examples.md).

[W19 dynamic Definition retrieval](w19-dynamic-definition-retrieval.md) is a
historical proposal concerning v1. Its references to a future v2 design describe
that earlier context. The fixed v2 contract identifies a Form by its publisher's
version-fixed HTTPS specification URL; it does not require Host-side Definition
retrieval or v1 package verification. The proposal body is retained as design
history, not carried forward as a v2 requirement.

For both fixed contracts and actual repository implementation support, use
the [specification index](../README.md).
