package trust

import (
	"strings"
	"testing"

	"github.com/sigstore/sigstore-go/pkg/fulcio/certificate"
)

func TestVerifyCertificatePolicyValidatesProvenanceCommitsIndependently(t *testing.T) {
	t.Parallel()
	policy := PublisherPolicy{
		APIVersion:       PublisherPolicyAPIVersion,
		Kind:             PublisherPolicyKind,
		OIDCIssuer:       "https://token.actions.githubusercontent.com",
		SourceRepository: "https://github.com/publisher/forms",
		Workflow:         "https://github.com/publisher/forms/.github/workflows/release.yml",
		Ref:              "refs/heads/main",
	}
	valid := certificate.Summary{
		SubjectAlternativeName: policy.Identity(),
		Extensions: certificate.Extensions{
			Issuer:                 policy.OIDCIssuer,
			SourceRepositoryURI:    policy.SourceRepository,
			SourceRepositoryRef:    policy.Ref,
			BuildSignerURI:         policy.Identity(),
			SourceRepositoryDigest: "1111111111111111111111111111111111111111",
			BuildSignerDigest:      "2222222222222222222222222222222222222222",
			BuildConfigDigest:      "3333333333333333333333333333333333333333",
		},
	}
	if err := verifyCertificatePolicy(valid, policy); err != nil {
		t.Fatalf("distinct valid provenance commits were rejected: %v", err)
	}

	invalidDigests := map[string]string{
		"empty":       "",
		"short":       strings.Repeat("a", 39),
		"uppercase":   strings.Repeat("A", 40),
		"prefixed":    "sha1:" + strings.Repeat("a", 40),
		"non-hex":     strings.Repeat("g", 40),
		"null object": strings.Repeat("0", 40),
	}
	fields := map[string]func(*certificate.Summary, string){
		"source repository": func(summary *certificate.Summary, value string) {
			summary.SourceRepositoryDigest = value
		},
		"build signer": func(summary *certificate.Summary, value string) {
			summary.BuildSignerDigest = value
		},
		"build config": func(summary *certificate.Summary, value string) {
			summary.BuildConfigDigest = value
		},
	}
	for field, mutate := range fields {
		field, mutate := field, mutate
		t.Run(field, func(t *testing.T) {
			t.Parallel()
			for name, value := range invalidDigests {
				name, value := name, value
				t.Run(name, func(t *testing.T) {
					t.Parallel()
					actual := valid
					mutate(&actual, value)
					if err := verifyCertificatePolicy(actual, policy); err == nil {
						t.Fatal("invalid provenance commit unexpectedly accepted")
					}
				})
			}
		})
	}
}
