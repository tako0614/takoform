//go:build linux && amd64

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

const (
	proposalFormat         = "takoform.sealed-deploy-proposal@v2"
	reviewFormat           = "takoform.sealed-deploy-review@v2"
	capabilityFormat       = "takoform.broker-sealed-deploy-capability@v2"
	runRequestFormat       = "takoform.broker-attested-run-request@v1"
	reviewNamespace        = "takoform-sealed-continuation-review-v2"
	reviewerPrincipal      = "takoform-sealed-continuation-independent-reviewer"
	credentialClass        = "broker-bound-exact-phase-authority-envelope"
	installedBrokerPath    = "/usr/local/libexec/takoform-sealed-deploy-broker"
	installedTrustRootPath = "/etc/takoform/release/sealed-continuation-review.pub"
	installedStateRoot     = "/var/lib/takoform-sealed-deploy-broker"
	installedNodePath      = "/usr/local/bin/node"
	installedBunPath       = "/usr/local/lib/node_modules/bun/node_modules/@oven/bun-linux-x64-baseline/bin/bun"
	installedGitPath       = "/usr/bin/git"
	installedSSHKeygenPath = "/usr/bin/ssh-keygen"
	sealedRunnerRelative   = "scripts/sealed-deploy-runner.mjs"
	pinnedTrustRootSHA256  = "sha256:2fa583d47379dd1501a21ec0545f2595bc282b2c52da4d3c03c553c1c30abf3a"
	pinnedTrustFingerprint = "SHA256:86DoAm86Ps8C2G97eVpFU/On8UyESZfVboCnX63tYXU"
	credentialInputFD      = 3
	maximumProposalBytes   = 16 * 1024 * 1024
	maximumReviewBytes     = 16 * 1024 * 1024
	maximumSignatureBytes  = 64 * 1024
	maximumCredentialBytes = 4 * 1024 * 1024
)

var digestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

type config struct {
	brokerPath         string
	brokerMode         uint32
	trustRootPath      string
	trustRootSHA256    string
	trustFingerprint   string
	stateRoot          string
	nodePath           string
	bunPath            string
	gitPath            string
	sshKeygenPath      string
	runnerRelativePath string
	namespace          string
	reviewerPrincipal  string
	credentialFD       int
	requireRoot        bool
	stdout             io.Writer
	stderr             io.Writer
	removeAll          func(string) error
}

func productionConfig() config {
	return config{
		brokerPath:         installedBrokerPath,
		brokerMode:         0o555,
		trustRootPath:      installedTrustRootPath,
		trustRootSHA256:    pinnedTrustRootSHA256,
		trustFingerprint:   pinnedTrustFingerprint,
		stateRoot:          installedStateRoot,
		nodePath:           installedNodePath,
		bunPath:            installedBunPath,
		gitPath:            installedGitPath,
		sshKeygenPath:      installedSSHKeygenPath,
		runnerRelativePath: sealedRunnerRelative,
		namespace:          reviewNamespace,
		reviewerPrincipal:  reviewerPrincipal,
		credentialFD:       credentialInputFD,
		requireRoot:        true,
		stdout:             os.Stdout,
		stderr:             os.Stderr,
		removeAll:          os.RemoveAll,
	}
}

type cliRequest struct {
	proposalPath   string
	proposalSHA256 string
	reviewPath     string
	signaturePath  string
}

func parseCLI(args []string) (cliRequest, error) {
	if len(args) != 8 || args[0] != "--proposal" || args[2] != "--proposal-sha256" || args[4] != "--review" || args[6] != "--signature" {
		return cliRequest{}, errors.New("exact CLI is --proposal <abs> --proposal-sha256 sha256:<64> --review <abs> --signature <abs>")
	}
	request := cliRequest{
		proposalPath: args[1], proposalSHA256: args[3], reviewPath: args[5], signaturePath: args[7],
	}
	for label, path := range map[string]string{
		"proposal":  request.proposalPath,
		"review":    request.reviewPath,
		"signature": request.signaturePath,
	} {
		if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return cliRequest{}, fmt.Errorf("%s path must be one clean absolute path", label)
		}
	}
	if !digestPattern.MatchString(request.proposalSHA256) {
		return cliRequest{}, errors.New("proposal SHA-256 is not canonical")
	}
	return request, nil
}

func rejectAmbientEnvironment(environment []string) error {
	if len(environment) != 0 {
		return errors.New("ambient environment must be exactly empty")
	}
	return nil
}

func run(cfg config, args, environment []string) error {
	// This is intentionally the first observable validation. In particular, no
	// proposal, signature, state, or credential FD is touched first.
	if err := rejectAmbientEnvironment(environment); err != nil {
		return err
	}
	request, err := parseCLI(args)
	if err != nil {
		return err
	}
	// Inspect and seal the inherited credential descriptor before proposal
	// validation. Production validation has no child-execution surface; the only
	// child is the final Node runner after capability consume and credential read.
	credentialMetadata, err := validateCredentialFDMetadata(cfg.credentialFD)
	if err != nil {
		return err
	}
	return execute(cfg, request, credentialMetadata)
}

func main() {
	if err := run(productionConfig(), os.Args[1:], os.Environ()); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "sealed deploy broker refused: %s\n", err)
		os.Exit(1)
	}
}
