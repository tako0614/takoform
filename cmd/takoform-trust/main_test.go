package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tako0614/takoform/formpackage"
	"github.com/tako0614/takoform/trust"
)

func TestVersionCommandEmitsStableJSON(t *testing.T) {
	t.Parallel()
	var output bytes.Buffer
	if err := run([]string{"version"}, &output); err != nil {
		t.Fatal(err)
	}
	want := "{\"command\":\"takoform-trust\",\"module\":\"github.com/tako0614/takoform\",\"version\":\"devel\"}\n"
	if output.String() != want {
		t.Fatalf("version output = %q, want %q", output.String(), want)
	}
}

func TestVersionCommandRejectsUnknownArguments(t *testing.T) {
	t.Parallel()
	if err := run([]string{"version", "unexpected"}, &bytes.Buffer{}); err == nil {
		t.Fatal("version accepted an unknown argument")
	}
}

func TestVerifyBundleCommandEmitsStableJSONFromExplicitFiles(t *testing.T) {
	t.Parallel()
	fixtureRoot := filepath.Join("..", "..", "trust", "testdata")
	policyPath := writePolicyFile(t, fixturePolicy())
	arguments := []string{
		"verify-bundle",
		"--subject", filepath.Join(fixtureRoot, "subject.txt"),
		"--bundle", filepath.Join(fixtureRoot, "cosign-v3.0.6-message-signature.sigstore.json"),
		"--trusted-root", filepath.Join(fixtureRoot, "trusted-root.json"),
		"--policy", policyPath,
	}

	var first bytes.Buffer
	if err := run(arguments, &first); err != nil {
		t.Fatalf("verify-bundle: %v", err)
	}
	var second bytes.Buffer
	if err := run(arguments, &second); err != nil {
		t.Fatalf("repeat verify-bundle: %v", err)
	}
	if !bytes.Equal(first.Bytes(), second.Bytes()) {
		t.Fatalf("stable invocation changed JSON:\nfirst:  %s\nsecond: %s", first.Bytes(), second.Bytes())
	}
	if bytes.Count(first.Bytes(), []byte{'\n'}) != 1 {
		t.Fatalf("output is not one stable JSON line: %q", first.Bytes())
	}
	var report trust.BundleVerification
	if err := json.Unmarshal(first.Bytes(), &report); err != nil {
		t.Fatalf("decode CLI output: %v", err)
	}
	if report.Status != trust.VerifiedStatus || report.PublisherIdentity != fixturePolicy().Identity() {
		t.Fatalf("unexpected CLI report: %+v", report)
	}
	const fixtureCommit = "5173386b3e898a607b99a87ae0dc6f386927ca9e"
	for _, member := range []string{
		`"sourceCommit":"` + fixtureCommit + `"`,
		`"workflowCommit":"` + fixtureCommit + `"`,
		`"buildConfigCommit":"` + fixtureCommit + `"`,
	} {
		if !bytes.Contains(first.Bytes(), []byte(member)) {
			t.Fatalf("public verification JSON is missing %s: %s", member, first.Bytes())
		}
	}
	for _, internalName := range []string{"sourceRepositoryDigest", "buildSignerDigest", "buildConfigDigest"} {
		if bytes.Contains(first.Bytes(), []byte(`"`+internalName+`"`)) {
			t.Fatalf("certificate extension name %q leaked into public JSON: %s", internalName, first.Bytes())
		}
	}
}

func TestCommandsRequireEveryTrustFileAndExactPolicy(t *testing.T) {
	t.Parallel()
	fixtureRoot := filepath.Join("..", "..", "trust", "testdata")
	policyPath := writePolicyFile(t, fixturePolicy())

	if err := run([]string{
		"verify-bundle",
		"--subject", filepath.Join(fixtureRoot, "subject.txt"),
		"--bundle", filepath.Join(fixtureRoot, "cosign-v3.0.6-message-signature.sigstore.json"),
		"--policy", policyPath,
	}, &bytes.Buffer{}); !errors.Is(err, errUsage) {
		t.Fatalf("missing trusted root error = %v", err)
	}

	invalidPolicy := fixturePolicy()
	invalidPolicy.Ref = "refs/heads/main"
	if err := run([]string{
		"verify-bundle",
		"--subject", filepath.Join(fixtureRoot, "subject.txt"),
		"--bundle", filepath.Join(fixtureRoot, "cosign-v3.0.6-message-signature.sigstore.json"),
		"--trusted-root", filepath.Join(fixtureRoot, "trusted-root.json"),
		"--policy", writePolicyFile(t, invalidPolicy),
	}, &bytes.Buffer{}); err == nil {
		t.Fatal("publisher policy mismatch unexpectedly verified")
	}
}

func TestVerifyCheckpointAndRevocationCommandsAuthenticateExactCheckpointSubject(t *testing.T) {
	t.Parallel()
	fixtureRoot := filepath.Join("..", "..", "trust", "testdata")
	checkpointRaw, err := os.ReadFile(filepath.Join("..", "..", "conformance", "revocation-checkpoint-v1", "positive", "checkpoint-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := formpackage.Canonicalize(checkpointRaw)
	if err != nil {
		t.Fatal(err)
	}
	checkpointPath := filepath.Join(t.TempDir(), "checkpoint.json")
	if err := os.WriteFile(checkpointPath, canonical, 0o600); err != nil {
		t.Fatal(err)
	}
	policyPath := writePolicyFile(t, fixturePolicy())
	common := []string{
		"--checkpoint", checkpointPath,
		"--bundle", filepath.Join(fixtureRoot, "cosign-v3.0.6-message-signature.sigstore.json"),
		"--trusted-root", filepath.Join(fixtureRoot, "trusted-root.json"),
		"--policy", policyPath,
	}

	if err := run(append([]string{"verify-checkpoint"}, common...), &bytes.Buffer{}); err == nil {
		t.Fatal("bundle for a different subject authenticated the checkpoint")
	}
	formRefPath := filepath.Join(t.TempDir(), "form-ref.json")
	if err := os.WriteFile(formRefPath, []byte(`{"apiVersion":"forms.takoform.com/v1alpha1","kind":"ObjectBucket","definitionVersion":"1.0.0","schemaDigest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	checkArguments := append([]string{"check-not-revoked"}, common...)
	checkArguments = append(checkArguments,
		"--package-digest", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"--form-ref", formRefPath,
	)
	if err := run(checkArguments, &bytes.Buffer{}); err == nil {
		t.Fatal("revocation command skipped checkpoint signature verification")
	}
}

func TestReadPreviousPinAcceptsCurrentSequenceZeroAndRetainedLegacyShape(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	for name, raw := range map[string]string{
		"current genesis": fmt.Sprintf(`{"checkpointApiVersion":"trust.forms.takoform.com/v1","digest":%q,"entriesDigest":%q,"sequence":0}`, digest, digest),
		"retained legacy": fmt.Sprintf(`{"digest":%q,"entriesDigest":%q,"sequence":1}`, digest, digest),
	} {
		name, raw := name, raw
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "pin.json")
			if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := readPreviousPin(path); err != nil {
				t.Fatalf("read compatible previous pin: %v", err)
			}
		})
	}

	for name, raw := range map[string]string{
		"profileless sequence zero": fmt.Sprintf(`{"digest":%q,"entriesDigest":%q,"sequence":0}`, digest, digest),
		"unknown profile":           fmt.Sprintf(`{"checkpointApiVersion":"trust.forms.takoform.com/v2","digest":%q,"entriesDigest":%q,"sequence":1}`, digest, digest),
	} {
		name, raw := name, raw
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "pin.json")
			if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := readPreviousPin(path); err == nil {
				t.Fatal("invalid previous pin unexpectedly accepted")
			}
		})
	}
}

func TestFailureJSONUsesStableCodes(t *testing.T) {
	t.Parallel()
	var output bytes.Buffer
	if err := writeFailureJSON(&output, trust.ErrRevoked); err != nil {
		t.Fatal(err)
	}
	want := "{\"status\":\"error\",\"code\":\"revoked\",\"message\":\"Form Package is revoked\"}\n"
	if output.String() != want {
		t.Fatalf("failure JSON = %q, want %q", output.String(), want)
	}
}

func writePolicyFile(t *testing.T, policy trust.PublisherPolicy) string {
	t.Helper()
	raw, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "publisher-policy.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func fixturePolicy() trust.PublisherPolicy {
	const repository = "https://github.com/tako0614/terraform-provider-takoform"
	return trust.PublisherPolicy{
		APIVersion:       trust.PublisherPolicyAPIVersion,
		Kind:             trust.PublisherPolicyKind,
		OIDCIssuer:       "https://token.actions.githubusercontent.com",
		SourceRepository: repository,
		Workflow:         repository + "/.github/workflows/form-package-release.yml",
		Ref:              "refs/heads/agent/cosign-v3-shape-probe",
	}
}
