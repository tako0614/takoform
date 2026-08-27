package hostclient

import (
	"strings"
	"testing"
)

func TestGroupPathSegmentCarriesTheVersionlessGroupAsOneSegment(t *testing.T) {
	t.Parallel()
	if got := groupPathSegment("queue.example.net"); got != "queue.example.net" {
		t.Fatalf("groupPathSegment() = %q, want one unchanged path segment", got)
	}
}

func TestGroupPathSegmentNeverRevivesTheRetiredTwoSegmentShape(t *testing.T) {
	t.Parallel()
	got := groupPathSegment("queue.example.net/retired")
	if strings.Contains(got, "/") || !strings.Contains(strings.ToLower(got), "%2f") {
		t.Fatalf("groupPathSegment() = %q, want the invalid slash contained in one escaped segment", got)
	}
}
