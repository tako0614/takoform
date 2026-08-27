package trust

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/tako0614/takoform/formpackage"
)

const ValidCheckpointExtensionStatus = "valid-extension"

// CheckpointExtensionVerification is the deterministic result of validating
// one cumulative checkpoint against a caller-retained previous pin. It proves
// sequence, predecessor digest, and cumulative-prefix continuity; it is not a
// signature result. VerifyRevocationCheckpoint combines both layers.
type CheckpointExtensionVerification struct {
	Status            string                              `json:"status"`
	CheckpointVersion string                              `json:"checkpointVersion"`
	EntryCount        int                                 `json:"entryCount"`
	Pin               formpackage.RevocationCheckpointPin `json:"pin"`
}

// RevocationCheckpointVerification is issued only after both the exact
// checkpoint signature/publisher and its caller-pinned extension have been
// verified. Its zero value cannot authorize a revocation check.
type RevocationCheckpointVerification struct {
	Status            string                              `json:"status"`
	Bundle            BundleVerification                  `json:"bundle"`
	CheckpointVersion string                              `json:"checkpointVersion"`
	EntryCount        int                                 `json:"entryCount"`
	Pin               formpackage.RevocationCheckpointPin `json:"pin"`
	checkpoint        formpackage.RevocationCheckpoint
	verified          bool
}

// VerifyRevocationCheckpointExtension validates the generic append-only hash
// chain using formpackage's schema, RFC 8785 digest, and prefix primitives.
// The previous pin is always caller-supplied; nil is valid only for sequence 1.
// This function deliberately does not imply signature verification.
func VerifyRevocationCheckpointExtension(previous *formpackage.RevocationCheckpointPin, checkpointJSON []byte) (CheckpointExtensionVerification, error) {
	checkpoint, err := formpackage.ValidateRevocationCheckpoint(checkpointJSON)
	if err != nil {
		return CheckpointExtensionVerification{}, fmt.Errorf("%w: %v", ErrInvalidCheckpoint, err)
	}
	pin, err := formpackage.AdvanceRevocationCheckpoint(previous, checkpointJSON)
	if err != nil {
		return CheckpointExtensionVerification{}, fmt.Errorf("%w: %v", ErrInvalidCheckpoint, err)
	}
	return CheckpointExtensionVerification{
		Status:            ValidCheckpointExtensionStatus,
		CheckpointVersion: checkpoint.CheckpointVersion,
		EntryCount:        len(checkpoint.Entries),
		Pin:               pin,
	}, nil
}

// VerifyRevocationCheckpoint verifies a canonical checkpoint's Sigstore
// bundle over the exact bytes, exact caller policy, and caller trusted root,
// then checks append-only continuity against the caller's previous pin.
func VerifyRevocationCheckpoint(checkpointJSON, bundleJSON, trustedRootJSON []byte, policy PublisherPolicy, previous *formpackage.RevocationCheckpointPin) (RevocationCheckpointVerification, error) {
	canonical, err := formpackage.Canonicalize(checkpointJSON)
	if err != nil {
		return RevocationCheckpointVerification{}, fmt.Errorf("%w: %v", ErrInvalidCheckpoint, err)
	}
	if !bytes.Equal(checkpointJSON, canonical) {
		return RevocationCheckpointVerification{}, fmt.Errorf("%w: signed checkpoint bytes must be RFC 8785 canonical JSON", ErrInvalidCheckpoint)
	}
	bundleReport, err := VerifyBundle(checkpointJSON, bundleJSON, trustedRootJSON, policy)
	if err != nil {
		return RevocationCheckpointVerification{}, err
	}
	extension, err := VerifyRevocationCheckpointExtension(previous, checkpointJSON)
	if err != nil {
		return RevocationCheckpointVerification{}, err
	}
	checkpoint, err := formpackage.ValidateRevocationCheckpoint(checkpointJSON)
	if err != nil {
		return RevocationCheckpointVerification{}, fmt.Errorf("%w: %v", ErrInvalidCheckpoint, err)
	}
	return RevocationCheckpointVerification{
		Status:            VerifiedStatus,
		Bundle:            bundleReport,
		CheckpointVersion: extension.CheckpointVersion,
		EntryCount:        extension.EntryCount,
		Pin:               extension.Pin,
		checkpoint:        checkpoint,
		verified:          true,
	}, nil
}

// CheckNotRevoked checks an exact package identity against this verified,
// cumulative checkpoint.
func (verification RevocationCheckpointVerification) CheckNotRevoked(packageDigest string, formRef formpackage.FormRef) error {
	if !verification.verified || verification.Status != VerifiedStatus {
		return fmt.Errorf("%w: checkpoint verification capability is invalid", ErrInvalidCheckpoint)
	}
	return checkNotRevoked(verification.checkpoint, packageDigest, formRef)
}

func checkNotRevoked(checkpoint formpackage.RevocationCheckpoint, packageDigest string, formRef formpackage.FormRef) error {
	if !formpackage.ValidDigest(packageDigest) {
		return fmt.Errorf("%w: package digest is not canonical", ErrInvalidCheckpoint)
	}
	rawRef, err := json.Marshal(formRef)
	if err != nil {
		return fmt.Errorf("%w: encode FormRef: %v", ErrInvalidCheckpoint, err)
	}
	if _, err := formpackage.ValidateFormRef(rawRef); err != nil {
		return fmt.Errorf("%w: FormRef: %v", ErrInvalidCheckpoint, err)
	}
	for _, entry := range checkpoint.Entries {
		if entry.PackageDigest != packageDigest {
			continue
		}
		if entry.FormRef != formRef {
			return fmt.Errorf("%w: checkpoint maps package digest to a different FormRef", ErrInvalidCheckpoint)
		}
		return fmt.Errorf("%w: statement %s at sequence %d", ErrRevoked, entry.StatementVersion, entry.Sequence)
	}
	return nil
}
