package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/tako0614/takoform/formpackage"
	"github.com/tako0614/takoform/internal/buildinfo"
	"github.com/tako0614/takoform/trust"
)

var errUsage = errors.New("usage: takoform-trust version | verify-bundle --subject FILE --bundle FILE --trusted-root FILE --policy FILE | verify-checkpoint --checkpoint FILE --bundle FILE --trusted-root FILE --policy FILE [--previous-pin FILE] | check-not-revoked --checkpoint FILE --bundle FILE --trusted-root FILE --policy FILE [--previous-pin FILE] --package-digest DIGEST --form-ref FILE")

type failureReport struct {
	Status  string `json:"status"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type notRevokedReport struct {
	Status        string                                 `json:"status"`
	PackageDigest string                                 `json:"packageDigest"`
	FormRef       formpackage.FormRef                    `json:"formRef"`
	Checkpoint    trust.RevocationCheckpointVerification `json:"checkpoint"`
}

type verificationFiles struct {
	subjectPath     string
	bundlePath      string
	trustedRootPath string
	policyPath      string
}

type checkpointFiles struct {
	checkpointPath  string
	bundlePath      string
	trustedRootPath string
	policyPath      string
	previousPinPath string
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		_ = writeFailureJSON(os.Stderr, err)
		if errors.Is(err, errUsage) {
			os.Exit(2)
		}
		os.Exit(1)
	}
}

func run(arguments []string, output io.Writer) error {
	if len(arguments) == 0 {
		return errUsage
	}
	switch arguments[0] {
	case "version":
		if len(arguments) != 1 {
			return errUsage
		}
		return buildinfo.WriteJSON(output, "takoform-trust")
	case "verify-bundle":
		return runVerifyBundle(arguments[1:], output)
	case "verify-checkpoint":
		return runVerifyCheckpoint(arguments[1:], output)
	case "check-not-revoked":
		return runCheckNotRevoked(arguments[1:], output)
	default:
		return errUsage
	}
}

func runVerifyBundle(arguments []string, output io.Writer) error {
	flags := flag.NewFlagSet("verify-bundle", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	files := verificationFiles{}
	flags.StringVar(&files.subjectPath, "subject", "", "exact signed subject file")
	flags.StringVar(&files.bundlePath, "bundle", "", "Sigstore v0.3 bundle file")
	flags.StringVar(&files.trustedRootPath, "trusted-root", "", "caller-selected Sigstore trusted-root file")
	flags.StringVar(&files.policyPath, "policy", "", "exact publisher-policy file")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 ||
		files.subjectPath == "" || files.bundlePath == "" || files.trustedRootPath == "" || files.policyPath == "" {
		return errUsage
	}
	subject, bundle, trustedRoot, policy, err := readVerificationFiles(files)
	if err != nil {
		return err
	}
	report, err := trust.VerifyBundle(subject, bundle, trustedRoot, policy)
	if err != nil {
		return err
	}
	return writeJSON(output, report)
}

func runVerifyCheckpoint(arguments []string, output io.Writer) error {
	files, _, _, err := parseCheckpointFlags("verify-checkpoint", arguments, false)
	if err != nil {
		return err
	}
	report, err := verifyCheckpointFiles(files)
	if err != nil {
		return err
	}
	return writeJSON(output, report)
}

func runCheckNotRevoked(arguments []string, output io.Writer) error {
	files, packageDigest, formRefPath, err := parseCheckpointFlags("check-not-revoked", arguments, true)
	if err != nil {
		return err
	}
	report, err := verifyCheckpointFiles(files)
	if err != nil {
		return err
	}
	formRefRaw, err := readInputFile("form-ref", formRefPath)
	if err != nil {
		return err
	}
	formRef, err := formpackage.ValidateFormRef(formRefRaw)
	if err != nil {
		return fmt.Errorf("form-ref: %w", err)
	}
	if err := report.CheckNotRevoked(packageDigest, formRef); err != nil {
		return err
	}
	return writeJSON(output, notRevokedReport{
		Status:        "not-revoked",
		PackageDigest: packageDigest,
		FormRef:       formRef,
		Checkpoint:    report,
	})
}

func parseCheckpointFlags(name string, arguments []string, requirePackage bool) (checkpointFiles, string, string, error) {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	files := checkpointFiles{}
	flags.StringVar(&files.checkpointPath, "checkpoint", "", "exact canonical revocation-checkpoint file")
	flags.StringVar(&files.bundlePath, "bundle", "", "Sigstore v0.3 bundle for the checkpoint")
	flags.StringVar(&files.trustedRootPath, "trusted-root", "", "caller-selected Sigstore trusted-root file")
	flags.StringVar(&files.policyPath, "policy", "", "exact publisher-policy file")
	flags.StringVar(&files.previousPinPath, "previous-pin", "", "caller-retained previous checkpoint pin file")
	packageDigest := ""
	formRefPath := ""
	if requirePackage {
		flags.StringVar(&packageDigest, "package-digest", "", "exact Form Package digest")
		flags.StringVar(&formRefPath, "form-ref", "", "exact FormRef file")
	}
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 ||
		files.checkpointPath == "" || files.bundlePath == "" || files.trustedRootPath == "" || files.policyPath == "" ||
		(requirePackage && (packageDigest == "" || formRefPath == "")) {
		return checkpointFiles{}, "", "", errUsage
	}
	return files, packageDigest, formRefPath, nil
}

func verifyCheckpointFiles(files checkpointFiles) (trust.RevocationCheckpointVerification, error) {
	checkpoint, err := readInputFile("checkpoint", files.checkpointPath)
	if err != nil {
		return trust.RevocationCheckpointVerification{}, err
	}
	bundle, err := readInputFile("bundle", files.bundlePath)
	if err != nil {
		return trust.RevocationCheckpointVerification{}, err
	}
	trustedRoot, err := readInputFile("trusted-root", files.trustedRootPath)
	if err != nil {
		return trust.RevocationCheckpointVerification{}, err
	}
	policyRaw, err := readInputFile("policy", files.policyPath)
	if err != nil {
		return trust.RevocationCheckpointVerification{}, err
	}
	policy, err := trust.ParsePublisherPolicy(policyRaw)
	if err != nil {
		return trust.RevocationCheckpointVerification{}, err
	}
	previous, err := readPreviousPin(files.previousPinPath)
	if err != nil {
		return trust.RevocationCheckpointVerification{}, err
	}
	report, err := trust.VerifyRevocationCheckpoint(checkpoint, bundle, trustedRoot, policy, previous)
	if err != nil {
		return trust.RevocationCheckpointVerification{}, err
	}
	return report, nil
}

func readVerificationFiles(files verificationFiles) ([]byte, []byte, []byte, trust.PublisherPolicy, error) {
	subject, err := readInputFile("subject", files.subjectPath)
	if err != nil {
		return nil, nil, nil, trust.PublisherPolicy{}, err
	}
	bundle, err := readInputFile("bundle", files.bundlePath)
	if err != nil {
		return nil, nil, nil, trust.PublisherPolicy{}, err
	}
	trustedRoot, err := readInputFile("trusted-root", files.trustedRootPath)
	if err != nil {
		return nil, nil, nil, trust.PublisherPolicy{}, err
	}
	policyRaw, err := readInputFile("policy", files.policyPath)
	if err != nil {
		return nil, nil, nil, trust.PublisherPolicy{}, err
	}
	policy, err := trust.ParsePublisherPolicy(policyRaw)
	if err != nil {
		return nil, nil, nil, trust.PublisherPolicy{}, err
	}
	return subject, bundle, trustedRoot, policy, nil
}

func readPreviousPin(path string) (*formpackage.RevocationCheckpointPin, error) {
	if path == "" {
		return nil, nil
	}
	raw, err := readInputFile("previous-pin", path)
	if err != nil {
		return nil, err
	}
	if _, err := formpackage.Canonicalize(raw); err != nil {
		return nil, fmt.Errorf("previous-pin: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var pin formpackage.RevocationCheckpointPin
	if err := decoder.Decode(&pin); err != nil {
		return nil, fmt.Errorf("previous-pin: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("previous-pin: trailing JSON value")
	}
	if !formpackage.ValidDigest(pin.Digest) || !formpackage.ValidDigest(pin.EntriesDigest) {
		return nil, fmt.Errorf("previous-pin: canonical digests are required")
	}
	switch pin.CheckpointAPIVersion {
	case "":
		if pin.Sequence == 0 {
			return nil, fmt.Errorf("previous-pin: legacy profile requires sequence 1 or greater")
		}
	case formpackage.CurrentTrustAPIVersion:
		// Sequence zero is structurally reserved for the current-profile
		// genesis. AdvanceRevocationCheckpoint verifies its exact digest before
		// allowing sequence one; later pins retain the same format identity.
	default:
		return nil, fmt.Errorf("previous-pin: unsupported checkpointApiVersion %q", pin.CheckpointAPIVersion)
	}
	return &pin, nil
}

func readInputFile(label, path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s file: %w", label, err)
	}
	return raw, nil
}

func writeJSON(output io.Writer, value any) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func writeFailureJSON(output io.Writer, err error) error {
	return writeJSON(output, failureReport{Status: "error", Code: errorCode(err), Message: err.Error()})
}

func errorCode(err error) string {
	switch {
	case errors.Is(err, errUsage):
		return "usage"
	case errors.Is(err, trust.ErrInvalidPolicy):
		return "invalid-policy"
	case errors.Is(err, trust.ErrMalformedBundle):
		return "malformed-bundle"
	case errors.Is(err, trust.ErrMalformedTrustedRoot):
		return "malformed-trusted-root"
	case errors.Is(err, trust.ErrMissingTransparency):
		return "missing-transparency"
	case errors.Is(err, trust.ErrInvalidCheckpoint):
		return "invalid-checkpoint"
	case errors.Is(err, trust.ErrRevoked):
		return "revoked"
	case errors.Is(err, trust.ErrVerification):
		return "verification-failed"
	default:
		return "input-error"
	}
}
