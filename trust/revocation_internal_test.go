package trust

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tako0614/takoform/formpackage"
)

func TestCheckNotRevokedUsesExactPackageDigestAndFormRef(t *testing.T) {
	t.Parallel()
	checkpointJSON := readInternalRevocationFixture(t, "checkpoint-1.json")
	checkpoint, err := formpackage.ValidateRevocationCheckpoint(checkpointJSON)
	if err != nil {
		t.Fatal(err)
	}
	revoked := formpackage.FormRef{
		APIVersion:        "forms.takoform.com/v1alpha1",
		Kind:              "ObjectBucket",
		DefinitionVersion: "1.0.0",
		SchemaDigest:      "sha256:" + strings.Repeat("c", 64),
	}
	revokedDigest := "sha256:" + strings.Repeat("a", 64)

	if err := checkNotRevoked(checkpoint, revokedDigest, revoked); !errors.Is(err, ErrRevoked) {
		t.Fatalf("exact revoked package error = %v", err)
	}
	if err := checkNotRevoked(checkpoint, "sha256:"+strings.Repeat("b", 64), revoked); err != nil {
		t.Fatalf("different package digest was treated as revoked: %v", err)
	}
	contradictoryRef := revoked
	contradictoryRef.Kind = "DifferentKind"
	if err := checkNotRevoked(checkpoint, revokedDigest, contradictoryRef); !errors.Is(err, ErrInvalidCheckpoint) {
		t.Fatalf("digest/FormRef contradiction error = %v", err)
	}
	if err := checkNotRevoked(checkpoint, "not-a-digest", revoked); err == nil {
		t.Fatal("invalid package digest unexpectedly accepted")
	}
}

func readInternalRevocationFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "conformance", "revocation-checkpoint-v1", "positive", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
