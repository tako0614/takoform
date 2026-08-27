// Package trust verifies caller-selected Form Package publisher identities and
// Sigstore bundles without network access or ambient trust configuration.
package trust

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"unicode"

	"github.com/tako0614/takoform/formpackage"
)

const (
	// PublisherPolicyAPIVersion is the first caller-owned publisher policy
	// document. It grants no trust by itself; callers must also provide the
	// trusted-root and signed subject bytes for every verification.
	PublisherPolicyAPIVersion = "trust.forms.takoform.com/v1alpha1"
	PublisherPolicyKind       = "PublisherPolicy"
)

var (
	ErrInvalidPolicy        = errors.New("invalid publisher policy")
	ErrMalformedBundle      = errors.New("malformed Sigstore bundle")
	ErrMalformedTrustedRoot = errors.New("malformed Sigstore trusted root")
	ErrMissingTransparency  = errors.New("missing transparency-log inclusion proof")
	ErrVerification         = errors.New("Sigstore verification failed")
	ErrInvalidCheckpoint    = errors.New("invalid revocation checkpoint")
	ErrRevoked              = errors.New("Form Package is revoked")
)

// PublisherPolicy names one exact keyless publisher identity. There is no
// built-in publisher, trusted root, regex, tag pattern, or product-specific
// lane. Official and third-party publishers use this identical document.
//
// Workflow is the exact URI of the signing workflow without its ref suffix.
// Identity appends "@" and Ref and is matched literally against the Fulcio
// certificate SAN and build-signer URI.
type PublisherPolicy struct {
	APIVersion       string `json:"apiVersion"`
	Kind             string `json:"kind"`
	OIDCIssuer       string `json:"oidcIssuer"`
	SourceRepository string `json:"sourceRepository"`
	Workflow         string `json:"workflow"`
	Ref              string `json:"ref"`
}

// Identity returns the exact workflow/ref certificate identity selected by
// the policy. Call Validate before using a policy constructed in Go.
func (policy PublisherPolicy) Identity() string {
	return policy.Workflow + "@" + policy.Ref
}

// Validate rejects incomplete, ambiguous, normalized, or wildcard publisher
// policies. All comparisons performed by VerifyBundle are literal.
func (policy PublisherPolicy) Validate() error {
	if policy.APIVersion != PublisherPolicyAPIVersion {
		return fmt.Errorf("%w: apiVersion is %q, want %q", ErrInvalidPolicy, policy.APIVersion, PublisherPolicyAPIVersion)
	}
	if policy.Kind != PublisherPolicyKind {
		return fmt.Errorf("%w: kind is %q, want %q", ErrInvalidPolicy, policy.Kind, PublisherPolicyKind)
	}
	if err := validateExactURI("oidcIssuer", policy.OIDCIssuer); err != nil {
		return err
	}
	if err := validateExactURI("sourceRepository", policy.SourceRepository); err != nil {
		return err
	}
	if strings.HasSuffix(policy.SourceRepository, "/") {
		return fmt.Errorf("%w: sourceRepository must not end in slash", ErrInvalidPolicy)
	}
	if err := validateExactURI("workflow", policy.Workflow); err != nil {
		return err
	}
	if !strings.HasPrefix(policy.Workflow, policy.SourceRepository+"/") {
		return fmt.Errorf("%w: workflow must be an exact path within sourceRepository", ErrInvalidPolicy)
	}
	if strings.Contains(policy.Workflow, "@") {
		return fmt.Errorf("%w: workflow must not contain the ref separator", ErrInvalidPolicy)
	}
	refParts := strings.Split(policy.Ref, "/")
	if !strings.HasPrefix(policy.Ref, "refs/") || len(refParts) < 3 {
		return fmt.Errorf("%w: ref must be one exact refs/<namespace>/<name> identity", ErrInvalidPolicy)
	}
	for _, part := range refParts {
		if part == "" || part == "." || part == ".." {
			return fmt.Errorf("%w: ref contains an empty or relative path segment", ErrInvalidPolicy)
		}
	}
	if strings.ContainsAny(policy.Ref, "*?[]\\") || strings.ContainsFunc(policy.Ref, func(character rune) bool {
		return unicode.IsSpace(character) || unicode.IsControl(character)
	}) {
		return fmt.Errorf("%w: ref must not contain wildcards, escapes, or whitespace", ErrInvalidPolicy)
	}
	return nil
}

// ParsePublisherPolicy strictly decodes the public policy document. Unknown
// fields and non-I-JSON input fail closed instead of becoming ignored policy.
func ParsePublisherPolicy(raw []byte) (PublisherPolicy, error) {
	if _, err := formpackage.Canonicalize(raw); err != nil {
		return PublisherPolicy{}, fmt.Errorf("%w: %v", ErrInvalidPolicy, err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var policy PublisherPolicy
	if err := decoder.Decode(&policy); err != nil {
		return PublisherPolicy{}, fmt.Errorf("%w: decode: %v", ErrInvalidPolicy, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return PublisherPolicy{}, fmt.Errorf("%w: trailing JSON value", ErrInvalidPolicy)
	}
	if err := policy.Validate(); err != nil {
		return PublisherPolicy{}, err
	}
	return policy, nil
}

func validateExactURI(field, value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("%w: %s must be one exact absolute URI without user info, query, or fragment", ErrInvalidPolicy, field)
	}
	if parsed.String() != value || strings.ContainsFunc(value, unicode.IsSpace) {
		return fmt.Errorf("%w: %s must already be in its exact URI spelling", ErrInvalidPolicy, field)
	}
	return nil
}
