package trust

import (
	"bytes"
	"fmt"
	"strings"

	sigstorebundle "github.com/sigstore/sigstore-go/pkg/bundle"
	"github.com/sigstore/sigstore-go/pkg/fulcio/certificate"
	sigstoreroot "github.com/sigstore/sigstore-go/pkg/root"
	sigstoreverify "github.com/sigstore/sigstore-go/pkg/verify"
	"github.com/tako0614/takoform/formpackage"
)

const (
	VerifiedStatus         = "verified"
	sigstoreBundleVersion  = "v0.3"
	minimumEvidenceEntries = 1
)

// BundleVerification is stable, data-only evidence for one successful offline
// verification. It records exactly which caller inputs were authenticated.
type BundleVerification struct {
	Status                   string `json:"status"`
	SubjectDigest            string `json:"subjectDigest"`
	BundleDigest             string `json:"bundleDigest"`
	TrustedRootDigest        string `json:"trustedRootDigest"`
	OIDCIssuer               string `json:"oidcIssuer"`
	SourceRepository         string `json:"sourceRepository"`
	Workflow                 string `json:"workflow"`
	Ref                      string `json:"ref"`
	PublisherIdentity        string `json:"publisherIdentity"`
	SourceCommit             string `json:"sourceCommit"`
	WorkflowCommit           string `json:"workflowCommit"`
	BuildConfigCommit        string `json:"buildConfigCommit"`
	TransparencyLogVerified  bool   `json:"transparencyLogVerified"`
	TransparencyLogThreshold int    `json:"transparencyLogThreshold"`
}

// VerifyBundle cryptographically verifies a Sigstore v0.3 message-signature
// bundle over the exact subject bytes. Every trust input is caller-supplied;
// this function performs no network access, root discovery, or publisher
// selection.
func VerifyBundle(subject, bundleJSON, trustedRootJSON []byte, policy PublisherPolicy) (BundleVerification, error) {
	if len(subject) == 0 {
		return BundleVerification{}, fmt.Errorf("%w: signed subject is empty", ErrVerification)
	}
	if err := policy.Validate(); err != nil {
		return BundleVerification{}, err
	}

	trustedMaterial, err := parseTrustedRoot(trustedRootJSON)
	if err != nil {
		return BundleVerification{}, err
	}
	entity, err := parseBundle(bundleJSON)
	if err != nil {
		return BundleVerification{}, err
	}
	result, err := verifyEntity(subject, entity, trustedMaterial, policy)
	if err != nil {
		return BundleVerification{}, err
	}
	if result.Signature == nil || result.Signature.Certificate == nil {
		return BundleVerification{}, fmt.Errorf("%w: bundle is not certificate-signed", ErrVerification)
	}
	if err := verifyCertificatePolicy(*result.Signature.Certificate, policy); err != nil {
		return BundleVerification{}, err
	}

	return BundleVerification{
		Status:                   VerifiedStatus,
		SubjectDigest:            formpackage.DigestBytes(subject),
		BundleDigest:             formpackage.DigestBytes(bundleJSON),
		TrustedRootDigest:        formpackage.DigestBytes(trustedRootJSON),
		OIDCIssuer:               policy.OIDCIssuer,
		SourceRepository:         policy.SourceRepository,
		Workflow:                 policy.Workflow,
		Ref:                      policy.Ref,
		PublisherIdentity:        policy.Identity(),
		SourceCommit:             result.Signature.Certificate.SourceRepositoryDigest,
		WorkflowCommit:           result.Signature.Certificate.BuildSignerDigest,
		BuildConfigCommit:        result.Signature.Certificate.BuildConfigDigest,
		TransparencyLogVerified:  true,
		TransparencyLogThreshold: minimumEvidenceEntries,
	}, nil
}

func parseTrustedRoot(raw []byte) (*sigstoreroot.TrustedRoot, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("%w: input is empty", ErrMalformedTrustedRoot)
	}
	if _, err := formpackage.Canonicalize(raw); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedTrustedRoot, err)
	}
	trustedMaterial, err := sigstoreroot.NewTrustedRootFromJSON(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedTrustedRoot, err)
	}
	return trustedMaterial, nil
}

func parseBundle(raw []byte) (*sigstorebundle.Bundle, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("%w: input is empty", ErrMalformedBundle)
	}
	if _, err := formpackage.Canonicalize(raw); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedBundle, err)
	}
	var entity sigstorebundle.Bundle
	if err := entity.UnmarshalJSON(raw); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "inclusion proof") {
			return nil, fmt.Errorf("%w: %v", ErrMissingTransparency, err)
		}
		return nil, fmt.Errorf("%w: %v", ErrMalformedBundle, err)
	}
	version, err := entity.Version()
	if err != nil || version != sigstoreBundleVersion {
		return nil, fmt.Errorf("%w: bundle version is %q, want %s", ErrMalformedBundle, version, sigstoreBundleVersion)
	}
	signatureContent, err := entity.SignatureContent()
	if err != nil || signatureContent.MessageSignatureContent() == nil {
		return nil, fmt.Errorf("%w: bundle must contain a message signature", ErrMalformedBundle)
	}
	entries, err := entity.TlogEntries()
	if err != nil {
		return nil, fmt.Errorf("%w: transparency entries: %v", ErrMalformedBundle, err)
	}
	if len(entries) < minimumEvidenceEntries {
		return nil, ErrMissingTransparency
	}
	for index, entry := range entries {
		if entry == nil || !entry.HasInclusionProof() {
			return nil, fmt.Errorf("%w: entry %d", ErrMissingTransparency, index)
		}
	}
	return &entity, nil
}

func verifyEntity(subject []byte, entity sigstoreverify.SignedEntity, trustedMaterial sigstoreroot.TrustedMaterial, policy PublisherPolicy) (*sigstoreverify.VerificationResult, error) {
	verifier, err := sigstoreverify.NewVerifier(
		trustedMaterial,
		sigstoreverify.WithTransparencyLog(1),
		sigstoreverify.WithObserverTimestamps(1),
		sigstoreverify.WithSignedCertificateTimestamps(1),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: configure verifier: %v", ErrVerification, err)
	}
	identity, err := sigstoreverify.NewShortCertificateIdentity(policy.OIDCIssuer, "", policy.Identity(), "")
	if err != nil {
		return nil, fmt.Errorf("%w: certificate identity: %v", ErrInvalidPolicy, err)
	}
	result, err := verifier.Verify(
		entity,
		sigstoreverify.NewPolicy(
			sigstoreverify.WithArtifact(bytes.NewReader(subject)),
			sigstoreverify.WithCertificateIdentity(identity),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrVerification, err)
	}
	return result, nil
}

func verifyCertificatePolicy(actual certificate.Summary, policy PublisherPolicy) error {
	if actual.Issuer != policy.OIDCIssuer {
		return fmt.Errorf("%w: certificate OIDC issuer mismatch", ErrVerification)
	}
	if actual.SubjectAlternativeName != policy.Identity() {
		return fmt.Errorf("%w: certificate workflow/ref identity mismatch", ErrVerification)
	}
	if actual.SourceRepositoryURI != policy.SourceRepository {
		return fmt.Errorf("%w: certificate source repository mismatch", ErrVerification)
	}
	if actual.SourceRepositoryRef != policy.Ref {
		return fmt.Errorf("%w: certificate source repository ref mismatch", ErrVerification)
	}
	if actual.BuildSignerURI != policy.Identity() {
		return fmt.Errorf("%w: certificate build signer workflow/ref mismatch", ErrVerification)
	}
	claims := []struct {
		name   string
		digest string
	}{
		{name: "source repository", digest: actual.SourceRepositoryDigest},
		{name: "build signer", digest: actual.BuildSignerDigest},
		{name: "build config", digest: actual.BuildConfigDigest},
	}
	for _, claim := range claims {
		if !validGitCommitDigest(claim.digest) {
			return fmt.Errorf("%w: certificate %s digest is not a canonical Git commit", ErrVerification, claim.name)
		}
	}
	return nil
}

// validGitCommitDigest accepts the GitHub-compatible commit spelling carried
// by this trust profile: one non-null SHA-1 commit digest as 40 lowercase hex
// characters, with no algorithm prefix or surrounding normalization.
func validGitCommitDigest(value string) bool {
	if len(value) != 40 {
		return false
	}
	nonzero := false
	for _, character := range value {
		if character < '0' || (character > '9' && character < 'a') || character > 'f' {
			return false
		}
		if character != '0' {
			nonzero = true
		}
	}
	return nonzero
}
