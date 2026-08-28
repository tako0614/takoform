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
	stableRef := revoked
	stableRef.APIVersion = "storage.forms.publisher.example"
	stableRef.DefinitionVersion = "0.1.0"
	if err := checkNotRevoked(checkpoint, "sha256:"+strings.Repeat("b", 64), stableRef); !errors.Is(err, ErrInvalidCheckpoint) {
		t.Fatalf("legacy checkpoint authorized a stable FormRef: %v", err)
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

func TestVerifiedCurrentGenesisAuthorizesNotRevokedWithoutFakeEntry(t *testing.T) {
	t.Parallel()
	genesis := []byte(`{"apiVersion":"trust.forms.takoform.com/v1","checkpointVersion":"0.0.0","entries":[],"kind":"FormPackageRevocationCheckpoint","previousCheckpointDigest":null,"sequence":0}`)
	checkpoint, err := formpackage.ValidateRevocationCheckpoint(genesis)
	if err != nil {
		t.Fatal(err)
	}
	verification := RevocationCheckpointVerification{
		Status:            VerifiedStatus,
		CheckpointVersion: checkpoint.CheckpointVersion,
		EntryCount:        len(checkpoint.Entries),
		checkpoint:        checkpoint,
		verified:          true,
	}
	formRef := formpackage.FormRef{
		APIVersion:        "storage.forms.publisher.example",
		Kind:              "ObjectBucket",
		DefinitionVersion: "0.1.0",
		SchemaDigest:      "sha256:" + strings.Repeat("c", 64),
	}
	if err := verification.CheckNotRevoked("sha256:"+strings.Repeat("a", 64), formRef); err != nil {
		t.Fatalf("verified empty genesis rejected exact package as not revoked: %v", err)
	}
	legacyRef := formRef
	legacyRef.APIVersion = formpackage.LegacyFormAPIVersion
	legacyRef.DefinitionVersion = "1.0.0"
	if err := verification.CheckNotRevoked("sha256:"+strings.Repeat("a", 64), legacyRef); !errors.Is(err, ErrInvalidCheckpoint) {
		t.Fatalf("verified current genesis authorized a legacy FormRef: %v", err)
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
