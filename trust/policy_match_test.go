package trust

import (
	"testing"

	"github.com/sigstore/sigstore-go/pkg/fulcio/certificate"
)

// Publisher names do not choose a verification lane. This drives two distinct
// identities through the exact certificate-policy matcher used after the
// cryptographic verifier succeeds.
func TestDistinctPublisherPoliciesUseTheSameExactCertificateMatcher(t *testing.T) {
	t.Parallel()
	policies := []PublisherPolicy{
		{
			APIVersion:       PublisherPolicyAPIVersion,
			Kind:             PublisherPolicyKind,
			OIDCIssuer:       "https://issuer.publisher-one.example",
			SourceRepository: "https://code.publisher-one.example/team/forms",
			Workflow:         "https://code.publisher-one.example/team/forms/ci/publish",
			Ref:              "refs/heads/release",
		},
		{
			APIVersion:       PublisherPolicyAPIVersion,
			Kind:             PublisherPolicyKind,
			OIDCIssuer:       "https://issuer.publisher-two.example",
			SourceRepository: "https://git.publisher-two.example/public/forms",
			Workflow:         "https://git.publisher-two.example/public/forms/workflows/sign",
			Ref:              "refs/tags/forms-0.1.0",
		},
	}

	for _, policy := range policies {
		policy := policy
		t.Run(policy.SourceRepository, func(t *testing.T) {
			t.Parallel()
			if err := policy.Validate(); err != nil {
				t.Fatal(err)
			}
			actual := certificate.Summary{
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
			if err := verifyCertificatePolicy(actual, policy); err != nil {
				t.Fatalf("exact publisher certificate rejected: %v", err)
			}
		})
	}
}
