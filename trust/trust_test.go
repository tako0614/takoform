package trust_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tako0614/takoform/formpackage"
	"github.com/tako0614/takoform/trust"
)

func TestVerifyBundleCryptographicallyOffline(t *testing.T) {
	t.Parallel()
	subject, bundle, trustedRoot := readSigstoreFixture(t)
	policy := fixturePolicy()

	report, err := trust.VerifyBundle(subject, bundle, trustedRoot, policy)
	if err != nil {
		t.Fatalf("verify real Cosign v3 bundle offline: %v", err)
	}
	if report.Status != trust.VerifiedStatus ||
		report.SubjectDigest != formpackage.DigestBytes(subject) ||
		report.PublisherIdentity != policy.Identity() ||
		!report.TransparencyLogVerified || report.TransparencyLogThreshold != 1 {
		t.Fatalf("unexpected verification report: %+v", report)
	}
}

func TestVerifyBundleFailsClosedOnEveryTrustInput(t *testing.T) {
	t.Parallel()
	subject, bundle, trustedRoot := readSigstoreFixture(t)

	tests := map[string]struct {
		subject     []byte
		bundle      []byte
		trustedRoot []byte
		policy      trust.PublisherPolicy
	}{
		"subject": {
			subject: append(append([]byte(nil), subject...), '!'), bundle: bundle,
			trustedRoot: trustedRoot, policy: fixturePolicy(),
		},
		"bundle": {
			subject: subject, bundle: []byte(`{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json"}`),
			trustedRoot: trustedRoot, policy: fixturePolicy(),
		},
		"trusted root": {
			subject: subject, bundle: bundle, trustedRoot: []byte(`{}`), policy: fixturePolicy(),
		},
		"issuer policy": {
			subject: subject, bundle: bundle, trustedRoot: trustedRoot,
			policy: mutatePolicy(func(policy *trust.PublisherPolicy) { policy.OIDCIssuer = "https://issuer.example" }),
		},
		"source repository policy": {
			subject: subject, bundle: bundle, trustedRoot: trustedRoot,
			policy: mutatePolicy(func(policy *trust.PublisherPolicy) {
				policy.SourceRepository = "https://github.com/example/external-forms"
				policy.Workflow = policy.SourceRepository + "/.github/workflows/release.yml"
			}),
		},
		"workflow policy": {
			subject: subject, bundle: bundle, trustedRoot: trustedRoot,
			policy: mutatePolicy(func(policy *trust.PublisherPolicy) {
				policy.Workflow = policy.SourceRepository + "/.github/workflows/other.yml"
			}),
		},
		"ref policy": {
			subject: subject, bundle: bundle, trustedRoot: trustedRoot,
			policy: mutatePolicy(func(policy *trust.PublisherPolicy) { policy.Ref = "refs/heads/main" }),
		},
	}

	for name, test := range tests {
		name, test := name, test
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := trust.VerifyBundle(test.subject, test.bundle, test.trustedRoot, test.policy); err == nil {
				t.Fatal("untrusted input unexpectedly verified")
			}
		})
	}
}

func TestVerifyBundleRequiresTransparencyInclusionProof(t *testing.T) {
	t.Parallel()
	subject, bundle, trustedRoot := readSigstoreFixture(t)
	var document map[string]any
	if err := json.Unmarshal(bundle, &document); err != nil {
		t.Fatal(err)
	}
	material := document["verificationMaterial"].(map[string]any)
	entries := material["tlogEntries"].([]any)
	delete(entries[0].(map[string]any), "inclusionProof")
	withoutProof, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := trust.VerifyBundle(subject, withoutProof, trustedRoot, fixturePolicy()); err == nil ||
		!strings.Contains(err.Error(), "inclusion proof") {
		t.Fatalf("missing transparency proof error = %v", err)
	}
}

func TestVerifyBundleRejectsAWellFormedButUntrustedRoot(t *testing.T) {
	t.Parallel()
	subject, bundle, trustedRoot := readSigstoreFixture(t)
	var rootDocument map[string]any
	if err := json.Unmarshal(trustedRoot, &rootDocument); err != nil {
		t.Fatal(err)
	}
	// Keep a syntactically and structurally valid Sigstore root, but remove
	// every Fulcio trust anchor so the fixture certificate has no trust path.
	rootDocument["certificateAuthorities"] = []any{}
	wrongRootJSON, err := json.Marshal(rootDocument)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := trust.VerifyBundle(subject, bundle, wrongRootJSON, fixturePolicy()); err == nil ||
		!errors.Is(err, trust.ErrVerification) {
		t.Fatalf("well-formed untrusted root error = %v", err)
	}
}

func TestPublisherPolicyFormatIsClosedExactAndPublisherNeutral(t *testing.T) {
	t.Parallel()
	policies := []trust.PublisherPolicy{
		fixturePolicy(),
		{
			APIVersion:       trust.PublisherPolicyAPIVersion,
			Kind:             trust.PublisherPolicyKind,
			OIDCIssuer:       "https://oidc.publisher.example",
			SourceRepository: "https://code.publisher.example/team/forms",
			Workflow:         "https://code.publisher.example/team/forms/ci/publish",
			Ref:              "refs/heads/release",
		},
	}

	for index, policy := range policies {
		raw, err := json.Marshal(policy)
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := trust.ParsePublisherPolicy(raw)
		if err != nil {
			t.Fatalf("policy %d was rejected: %v", index, err)
		}
		if parsed != policy || parsed.Identity() != policy.Workflow+"@"+policy.Ref {
			t.Fatalf("policy %d changed on the shared path: got %+v", index, parsed)
		}
	}
	if policies[0].Identity() == policies[1].Identity() {
		t.Fatal("test requires two distinct publisher identities")
	}

	for name, raw := range map[string][]byte{
		"unknown field":               []byte(`{"apiVersion":"trust.forms.takoform.com/v1alpha1","kind":"PublisherPolicy","oidcIssuer":"https://issuer.example","sourceRepository":"https://code.example/a/b","workflow":"https://code.example/a/b/ci/release","ref":"refs/heads/main","official":true}`),
		"missing issuer":              []byte(`{"apiVersion":"trust.forms.takoform.com/v1alpha1","kind":"PublisherPolicy","oidcIssuer":"","sourceRepository":"https://code.example/a/b","workflow":"https://code.example/a/b/ci/release","ref":"refs/heads/main"}`),
		"workflow outside repository": []byte(`{"apiVersion":"trust.forms.takoform.com/v1alpha1","kind":"PublisherPolicy","oidcIssuer":"https://issuer.example","sourceRepository":"https://code.example/a/b","workflow":"https://attacker.example/ci/release","ref":"refs/heads/main"}`),
		"wildcard ref":                []byte(`{"apiVersion":"trust.forms.takoform.com/v1alpha1","kind":"PublisherPolicy","oidcIssuer":"https://issuer.example","sourceRepository":"https://code.example/a/b","workflow":"https://code.example/a/b/ci/release","ref":"refs/heads/*"}`),
	} {
		name, raw := name, raw
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := trust.ParsePublisherPolicy(raw); err == nil {
				t.Fatal("invalid publisher policy unexpectedly accepted")
			}
		})
	}
}

func readSigstoreFixture(t *testing.T) ([]byte, []byte, []byte) {
	t.Helper()
	read := func(name string) []byte {
		t.Helper()
		raw, err := os.ReadFile(filepath.Join("testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	return read("subject.txt"), read("cosign-v3.0.6-message-signature.sigstore.json"), read("trusted-root.json")
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

func mutatePolicy(mutate func(*trust.PublisherPolicy)) trust.PublisherPolicy {
	policy := fixturePolicy()
	mutate(&policy)
	return policy
}
