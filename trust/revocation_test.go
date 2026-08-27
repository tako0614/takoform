package trust_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tako0614/takoform/formpackage"
	"github.com/tako0614/takoform/trust"
)

func TestVerifyRevocationCheckpointExtensionDetectsRollbackForkAndPrefixRewrite(t *testing.T) {
	t.Parallel()
	first := readRevocationFixture(t, "checkpoint-1.json")
	second := readRevocationFixture(t, "checkpoint-2.json")

	firstResult, err := trust.VerifyRevocationCheckpointExtension(nil, first)
	if err != nil {
		t.Fatal(err)
	}
	secondResult, err := trust.VerifyRevocationCheckpointExtension(&firstResult.Pin, second)
	if err != nil {
		t.Fatal(err)
	}
	if firstResult.Status != trust.ValidCheckpointExtensionStatus ||
		firstResult.Pin.Sequence != 1 || secondResult.Pin.Sequence != 2 ||
		firstResult.Pin.Digest == secondResult.Pin.Digest ||
		!formpackage.ValidDigest(secondResult.Pin.EntriesDigest) {
		t.Fatalf("unexpected checkpoint extension reports: first=%+v second=%+v", firstResult, secondResult)
	}

	if _, err := trust.VerifyRevocationCheckpointExtension(&secondResult.Pin, first); err == nil {
		t.Fatal("rollback to an older checkpoint unexpectedly accepted")
	}
	forked := strings.Replace(string(second), firstResult.Pin.Digest, "sha256:"+strings.Repeat("e", 64), 1)
	if _, err := trust.VerifyRevocationCheckpointExtension(&firstResult.Pin, []byte(forked)); err == nil {
		t.Fatal("checkpoint fork unexpectedly accepted")
	}
	rewrittenPrefix := strings.Replace(
		string(second),
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"sha256:"+strings.Repeat("f", 64),
		1,
	)
	if _, err := trust.VerifyRevocationCheckpointExtension(&firstResult.Pin, []byte(rewrittenPrefix)); err == nil {
		t.Fatal("cumulative checkpoint prefix rewrite unexpectedly accepted")
	}
}

func TestUnverifiedCheckpointCannotAuthorizeNotRevoked(t *testing.T) {
	t.Parallel()
	var unverified trust.RevocationCheckpointVerification
	if err := unverified.CheckNotRevoked("sha256:"+strings.Repeat("a", 64), formpackage.FormRef{}); !errors.Is(err, trust.ErrInvalidCheckpoint) {
		t.Fatalf("zero verification capability error = %v", err)
	}
}

func TestVerifyRevocationCheckpointBindsSignatureToExactCheckpointBytes(t *testing.T) {
	t.Parallel()
	_, bundle, trustedRoot := readSigstoreFixture(t)
	checkpoint := readRevocationFixture(t, "checkpoint-1.json")
	first, err := trust.VerifyRevocationCheckpointExtension(nil, checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := formpackage.Canonicalize(checkpoint)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := trust.VerifyRevocationCheckpoint(canonical, bundle, trustedRoot, fixturePolicy(), nil); err == nil {
		t.Fatal("bundle for different subject unexpectedly authenticated checkpoint")
	}
	if _, err := trust.VerifyRevocationCheckpoint(canonical, bundle, trustedRoot, fixturePolicy(), &first.Pin); err == nil {
		t.Fatal("signature mismatch was hidden by checkpoint continuity")
	}
}

func readRevocationFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "conformance", "revocation-checkpoint-v1", "positive", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
