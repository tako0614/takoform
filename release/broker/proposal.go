package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const sourceReviewFormat = "takoform.sealed-deploy-source-review@v1"

var (
	commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	noncePattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type validatedProposal struct {
	proposalSHA256    string
	proposal          sealedProposal
	reviewSHA256      string
	sshsig            verifiedSSHSIG
	trust             reviewTrustRoot
	broker            runBrokerIdentity
	runtimeNode       runExecutableIdentity
	brokerIdentitySHA string
}

func execute(cfg config, request cliRequest, credentialMetadata fileIdentity) error {
	validated, err := validateProposalAndReview(cfg, request)
	if err != nil {
		return err
	}
	return executeValidated(cfg, validated, credentialMetadata)
}

func validateProposalAndReview(cfg config, request cliRequest) (*validatedProposal, error) {
	if cfg.requireRoot && (os.Geteuid() != 0 || os.Getegid() != 0) {
		return nil, errors.New("sealed deploy broker requires effective root:root custody")
	}
	proposalFile, err := openStableRegularFile(request.proposalPath, "sealed proposal", stableFilePolicy{
		maximum: maximumProposalBytes, exactMode: 0o600, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return nil, err
	}
	defer proposalFile.close()
	if err := requireProposalDigest(proposalFile.identity.SHA256, request.proposalSHA256); err != nil {
		return nil, err
	}
	var proposal sealedProposal
	if _, err := parseCanonicalJSON(proposalFile.raw, maximumProposalBytes, "sealed proposal", &proposal); err != nil {
		return nil, err
	}
	reviewFile, err := openStableRegularFile(request.reviewPath, "signed broker review", stableFilePolicy{
		maximum: maximumReviewBytes, exactMode: 0o600, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return nil, err
	}
	defer reviewFile.close()
	var review signedReview
	if _, err := parseCanonicalJSON(reviewFile.raw, maximumReviewBytes, "signed broker review", &review); err != nil {
		return nil, err
	}
	signatureFile, err := openStableRegularFile(request.signaturePath, "broker review SSHSIG", stableFilePolicy{
		maximum: maximumSignatureBytes, exactMode: 0o600, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return nil, err
	}
	defer signatureFile.close()
	trustFile, err := openStableRegularFile(cfg.trustRootPath, "installed review trust root", stableFilePolicy{
		maximum: 4096, exactMode: 0o444, exactUID: 0, exactGID: 0, exactNlink: 1,
	})
	if err != nil {
		return nil, err
	}
	defer trustFile.close()
	trust, err := parseReviewTrustRoot(trustFile.raw, cfg.trustRootSHA256, cfg.trustFingerprint)
	if err != nil {
		return nil, err
	}
	verifiedSignature, err := verifyReviewSSHSIG(signatureFile.raw, reviewFile.raw, trust, cfg.namespace)
	if err != nil {
		return nil, err
	}
	if err := validateSignedReview(cfg, &proposal, request.proposalSHA256, &review); err != nil {
		return nil, err
	}

	self, err := validateBrokerSelf(cfg, proposal.Launcher.Broker)
	if err != nil {
		return nil, err
	}
	if err := validateProposal(cfg, request, &proposal, trust, self); err != nil {
		return nil, err
	}
	brokerIdentityRaw, err := canonicalJSON(map[string]any{
		"path": self.Path, "sha256": self.SHA256, "dev": self.Dev, "ino": self.Ino,
		"uid": self.UID, "gid": self.GID, "mode": self.Mode,
		"staticBuildIdSha256": self.StaticBuildID_SHA256,
	})
	if err != nil {
		return nil, err
	}
	self.IdentityEnvelopeSHA256 = digestBytes(brokerIdentityRaw)
	node := toRunExecutable(proposal.Runtime.Node)
	return &validatedProposal{
		proposalSHA256: request.proposalSHA256, proposal: proposal,
		reviewSHA256: reviewFile.identity.SHA256,
		sshsig:       verifiedSignature, trust: trust, broker: self, runtimeNode: node,
		brokerIdentitySHA: self.IdentityEnvelopeSHA256,
	}, nil
}

func validateBrokerSelf(cfg config, expected executableIdentity) (runBrokerIdentity, error) {
	executable, err := os.Executable()
	if err != nil {
		return runBrokerIdentity{}, fmt.Errorf("resolve running broker executable: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil || resolved != cfg.brokerPath {
		return runBrokerIdentity{}, errors.New("running broker is not the exact installed executable path")
	}
	file, err := openStableRegularFile(cfg.brokerPath, "running sealed broker", stableFilePolicy{
		maximum: 256 * 1024 * 1024, exactMode: cfg.brokerMode, exactUID: 0, exactGID: 0, exactNlink: 1,
	})
	if err != nil {
		return runBrokerIdentity{}, err
	}
	defer file.close()
	live, err := openRunningExecutable(cfg.brokerPath, stableFilePolicy{
		maximum: 256 * 1024 * 1024, exactMode: cfg.brokerMode, exactUID: 0, exactGID: 0, exactNlink: 1,
	})
	if err != nil {
		return runBrokerIdentity{}, err
	}
	defer live.close()
	if err := requireIdentity(live.identity, file.identity, "live sealed broker", true, true); err != nil {
		return runBrokerIdentity{}, err
	}
	buildID, err := staticGoBuildID(live.raw)
	if err != nil {
		return runBrokerIdentity{}, err
	}
	if err := requireExecutableIdentity(live.identity, expected, "sealed broker"); err != nil || expected.StaticBuildID_SHA256 != buildID {
		if err != nil {
			return runBrokerIdentity{}, err
		}
		return runBrokerIdentity{}, errors.New("sealed broker static build-id changed")
	}
	return runBrokerIdentity{
		Path: live.identity.Path, SHA256: live.identity.SHA256, Dev: live.identity.Dev, Ino: live.identity.Ino,
		UID: live.identity.UID, GID: live.identity.GID, Mode: live.identity.Mode, StaticBuildID_SHA256: buildID,
	}, nil
}

func validateProposal(cfg config, request cliRequest, proposal *sealedProposal, trust reviewTrustRoot, self runBrokerIdentity) error {
	if proposal.Format != proposalFormat || !noncePattern.MatchString(proposal.Nonce) || !commitPattern.MatchString(proposal.Source.Commit) {
		return errors.New("sealed proposal format, nonce, or source commit is invalid")
	}
	if proposal.Root.Path != filepath.Dir(request.proposalPath) || proposal.Source.Root != filepath.Join(proposal.Root.Path, "source") || proposal.Root.Mode != 0o700 {
		return errors.New("sealed proposal root is not exact unprivileged private custody")
	}
	root, rootIdentity, err := openExactDirectory(proposal.Root.Path, "sealed proposal root", proposal.Root.UID, proposal.Root.GID, 0o700)
	if err != nil {
		return err
	}
	root.Close()
	if rootIdentity.Dev != proposal.Root.Dev || rootIdentity.Ino != proposal.Root.Ino {
		return errors.New("sealed proposal root identity changed")
	}
	if err := validateInvocationAndCredential(proposal.Invocation, proposal.Credential); err != nil {
		return err
	}
	if proposal.Launcher.StateRoot != cfg.stateRoot || proposal.Launcher.Broker.Path != cfg.brokerPath ||
		proposal.Launcher.Runner.Path != filepath.Join(proposal.Source.Root, filepath.FromSlash(cfg.runnerRelativePath)) {
		return errors.New("sealed proposal launcher paths differ from the installed contract")
	}
	if proposal.Review.Format != reviewFormat || proposal.Review.Namespace != cfg.namespace ||
		proposal.Review.TrustRootPath != cfg.trustRootPath || proposal.Review.TrustRootFingerprint != cfg.trustFingerprint ||
		proposal.Review.TrustRootRepositorySHA256 != trust.fileSHA256 || proposal.Review.TrustRootBlobSHA256 != trust.blobSHA256 {
		return errors.New("sealed proposal review authority differs from the pinned trust root")
	}
	if err := validateRuntime(cfg, proposal); err != nil {
		return err
	}
	inventory, err := inspectReviewedClosure(proposal.Source.Root, "sealed source")
	if err != nil {
		return err
	}
	if err := verifyInventory(proposal.Source.Inventory, inventory, "sealed source inventory"); err != nil {
		return err
	}
	manifest, tree, err := inventoryDigests(inventory)
	if err != nil || manifest != proposal.Source.InventorySHA256 || tree != proposal.Source.TreeSHA256 {
		return errors.New("sealed source closure digest changed")
	}
	if err := validateDetachedGitMetadata(proposal.Source.Root, proposal.Source.Commit, inventory); err != nil {
		return err
	}
	// Do not spawn Git while the broker still owns an unread credential FD.
	// The credentialless producer computed this evidence; the proposal digest,
	// source review, and pinned signed broker review bind it. The broker instead
	// independently verifies and later copies every closure byte and Git metadata
	// record without executing a parser child.
	if !digestPattern.MatchString(proposal.Source.RawSourceTreeSHA256) {
		return errors.New("sealed source raw Git tree evidence is not canonical")
	}
	if err := validateBoundInputs(proposal, self); err != nil {
		return err
	}
	runner, err := openStableRegularFile(proposal.Launcher.Runner.Path, "sealed deploy runner", stableFilePolicy{
		maximum: maximumProposalBytes, exactMode: 0o444, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return err
	}
	defer runner.close()
	if runner.identity.SHA256 != proposal.Launcher.Runner.SHA256 {
		return errors.New("sealed deploy runner digest changed")
	}
	trustCopy, err := openStableRegularFile(filepath.Join(proposal.Source.Root, "release", "authority", "core-release-continuation-review.pub"), "raw-source review trust root", stableFilePolicy{
		maximum: 4096, exactMode: 0o444, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return err
	}
	defer trustCopy.close()
	if trustCopy.identity.SHA256 != trust.fileSHA256 {
		return errors.New("raw-source review trust root differs from installed authority")
	}
	configRaw, err := canonicalJSON(map[string]any{
		"brokerExecutable": cfg.brokerPath, "brokerStateRoot": cfg.stateRoot,
		"credentialFd": cfg.credentialFD, "reviewNamespace": cfg.namespace,
		"runnerPath": proposal.Launcher.Runner.Path, "runtimeExecutable": cfg.nodePath,
		"trustRoot": cfg.trustRootPath,
	})
	if err != nil || digestBytes(configRaw) != proposal.Launcher.ConfigSHA256 {
		return errors.New("sealed launcher configuration digest changed")
	}
	expectedEvidence, err := proposalIdentityEvidence(proposal)
	if err != nil {
		return err
	}
	if !canonicalEqual(proposal.IdentityEvidence, expectedEvidence) {
		return errors.New("sealed proposal identity evidence is open or inconsistent")
	}
	return nil
}

func validateRuntime(cfg config, proposal *sealedProposal) error {
	for _, item := range []struct {
		label    string
		expected string
		identity *executableIdentity
	}{
		{"sealed Node runtime", cfg.nodePath, &proposal.Runtime.Node},
		{"reviewed continuation Git tool", cfg.gitPath, &proposal.Runtime.ContinuationTools.Git},
		{"reviewed continuation ssh-keygen tool", cfg.sshKeygenPath, &proposal.Runtime.ContinuationTools.SSHKeygen},
		{"credentialless preparation Git tool", cfg.gitPath, &proposal.PreparationTools.Git},
	} {
		if item.identity.Path != item.expected || item.identity.Mode&0o111 == 0 || item.identity.Mode&0o022 != 0 || item.identity.Nlink != 1 {
			return fmt.Errorf("%s binding is invalid", item.label)
		}
		file, err := openStableRegularFile(item.expected, item.label, stableFilePolicy{
			maximum: 256 * 1024 * 1024, exactMode: item.identity.Mode, exactUID: 0, exactGID: 0, exactNlink: 1,
		})
		if err != nil {
			return err
		}
		err = requireExecutableIdentity(file.identity, *item.identity, item.label)
		file.close()
		if err != nil {
			return err
		}
	}
	requiresBun := proposal.Invocation.Surface == "takoform-specification-release" || proposal.Invocation.Surface == "takoform-schema-origin"
	if requiresBun != (proposal.PreparationTools.Bun != nil) {
		return errors.New("credentialless preparation Bun binding differs from the exact surface role")
	}
	if proposal.PreparationTools.Bun != nil {
		bun := proposal.PreparationTools.Bun
		if bun.Path != cfg.bunPath || bun.Mode&0o111 == 0 || bun.Mode&0o022 != 0 || bun.Nlink != 1 {
			return errors.New("credentialless preparation Bun binding is invalid")
		}
		file, err := openStableRegularFile(cfg.bunPath, "credentialless preparation Bun tool", stableFilePolicy{
			maximum: 256 * 1024 * 1024, exactMode: bun.Mode, exactUID: 0, exactGID: 0, exactNlink: 1,
		})
		if err != nil {
			return err
		}
		err = requireExecutableIdentity(file.identity, *bun, "credentialless preparation Bun tool")
		file.close()
		if err != nil {
			return err
		}
	}
	runtimeRaw, err := canonicalJSON(proposal.Runtime)
	if err != nil {
		return err
	}
	if value, ok := proposal.IdentityEvidence["runtime.runtime-dependency-closure-sha256"].(string); !ok || value != digestBytes(runtimeRaw) {
		return errors.New("sealed runtime dependency-closure digest changed")
	}
	return nil
}

func validateBoundInputs(proposal *sealedProposal, self runBrokerIdentity) error {
	inputsRoot := filepath.Join(proposal.Root.Path, "inputs")
	if directory, _, err := openExactDirectory(inputsRoot, "sealed bound inputs", proposal.Root.UID, proposal.Root.GID, 0o555); err != nil {
		return err
	} else {
		directory.Close()
	}
	seenPaths := map[string]struct{}{}
	seenSourceReview := false
	for _, input := range proposal.Inputs {
		if !pathWithin(inputsRoot, input.Path) {
			return errors.New("sealed input escapes its exact input root")
		}
		if _, exists := seenPaths[input.Path]; exists {
			return errors.New("sealed proposal repeats a bound input path")
		}
		seenPaths[input.Path] = struct{}{}
		switch input.Type {
		case "file":
			if len(input.Inventory) != 0 || input.ManifestSHA256 != "" || input.TreeSHA256 != "" {
				return errors.New("sealed file input carries directory-only fields")
			}
			file, err := openStableRegularFile(input.Path, "sealed bound file", stableFilePolicy{
				maximum: maximumClosureFileBytes, exactMode: 0o400, exactNlink: 1, allowAnyOwner: true,
			})
			if err != nil {
				return err
			}
			if file.identity.SHA256 != input.SHA256 || !sameProposalFileIdentity(file.identity, input.Identity) {
				file.close()
				return errors.New("sealed bound file identity changed")
			}
			file.close()
		case "directory":
			if input.SHA256 != "" || input.Identity != (proposalFileIdentity{}) {
				return errors.New("sealed directory input carries file-only fields")
			}
			actual, err := inspectReviewedClosure(input.Path, "sealed directory input")
			if err != nil {
				return err
			}
			if err := verifyInventory(input.Inventory, actual, "sealed directory input inventory"); err != nil {
				return err
			}
			manifest, tree, err := inventoryDigests(actual)
			if err != nil || manifest != input.ManifestSHA256 || tree != input.TreeSHA256 {
				return errors.New("sealed directory input digest changed")
			}
		default:
			return errors.New("sealed proposal has an unknown input artifact type")
		}
		if input.Flag == "--continuation-review" {
			if seenSourceReview || input.Type != "file" || input.Path != proposal.Source.ReviewRecord.Path ||
				input.SHA256 != proposal.Source.ReviewRecord.SHA256 || !sameBoundIdentity(input.Identity, proposal.Source.ReviewRecord.Identity) {
				return errors.New("sealed proposal source review input is inconsistent")
			}
			seenSourceReview = true
		} else if !invocationBindsInput(proposal.Invocation.Args, input.Flag, input.Path) {
			return fmt.Errorf("sealed input %s is not bound by the invocation", input.Flag)
		}
	}
	if !seenSourceReview {
		return errors.New("sealed proposal lacks its source review input")
	}
	reviewFile, err := openStableRegularFile(proposal.Source.ReviewRecord.Path, "sealed source review", stableFilePolicy{
		maximum: 1024 * 1024, exactMode: 0o400, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return err
	}
	defer reviewFile.close()
	if reviewFile.identity.SHA256 != proposal.Source.ReviewRecord.SHA256 || !sameProposalFileIdentity(reviewFile.identity, proposal.Source.ReviewRecord.Identity) {
		return errors.New("sealed source review identity changed")
	}
	var review sourceReview
	if _, err := parseCanonicalJSON(reviewFile.raw, 1024*1024, "sealed source review", &review); err != nil {
		return err
	}
	return validateSourceReviewBinding(review, proposal, self)
}

func validateSourceReviewBinding(review sourceReview, proposal *sealedProposal, self runBrokerIdentity) error {
	expectedTopics := []string{"broker-static-boundary", "raw-reviewed-source", "sealed-closure-proposal"}
	if !review.Approved || review.Format != sourceReviewFormat || review.BrokerSHA256 != self.SHA256 || review.Source != proposal.Source.Commit ||
		review.RawSourceTreeSHA256 != proposal.Source.RawSourceTreeSHA256 || !digestPattern.MatchString(review.RawSourceTreeSHA256) ||
		review.Reviewer != reviewerPrincipal || !stringSliceEqual(review.Reviewed, expectedTopics) || !canonicalUTCTimestamp(review.ReviewedAt) {
		return errors.New("sealed source review does not bind exact source and broker")
	}
	return nil
}

func requireProposalDigest(actual, expected string) error {
	if actual != expected || !digestPattern.MatchString(expected) {
		return errors.New("sealed proposal digest differs from the exact CLI binding")
	}
	return nil
}

func validateSignedReview(cfg config, proposal *sealedProposal, proposalSHA string, review *signedReview) error {
	expectedSource := sourceBinding{
		Commit: proposal.Source.Commit, RawSourceTreeSHA256: proposal.Source.RawSourceTreeSHA256,
		SourceReviewSHA256:    proposal.Source.ReviewRecord.SHA256,
		ClosureManifestSHA256: proposal.Source.InventorySHA256, ClosureTreeSHA256: proposal.Source.TreeSHA256,
	}
	if !review.Approved || review.Format != reviewFormat || review.ProposalSHA256 != proposalSHA ||
		review.ReviewNamespace != cfg.namespace || review.Reviewer != cfg.reviewerPrincipal ||
		review.TrustRootFingerprint != cfg.trustFingerprint || !canonicalUTCTimestamp(review.ReviewedAt) ||
		!canonicalEqual(review.Invocation, proposal.Invocation) || !canonicalEqual(review.BoundIdentityEvidence, proposal.IdentityEvidence) ||
		!canonicalEqual(review.SourceBinding, expectedSource) {
		return errors.New("signed broker review does not exactly approve and bind the proposal")
	}
	return nil
}

func validateInvocationAndCredential(invocation invocation, credential credentialBinding) error {
	if len(invocation.Args) < 2 || invocation.Args[0] != invocation.Surface || invocation.Args[1] != invocation.Phase ||
		invocation.Surface == "" || invocation.Phase == "" || !digestPattern.MatchString(invocation.SHA256) {
		return errors.New("sealed invocation is invalid")
	}
	for _, value := range invocation.Args {
		if value == "" || strings.ContainsRune(value, 0) {
			return errors.New("sealed invocation contains an empty or NUL argument")
		}
	}
	invocationRaw, err := canonicalJSON(map[string]any{"args": invocation.Args, "phase": invocation.Phase, "surface": invocation.Surface})
	if err != nil || digestBytes(invocationRaw) != invocation.SHA256 {
		return errors.New("sealed invocation digest changed")
	}
	expected, err := expectedCredentialNames(invocation)
	if err != nil {
		return err
	}
	if credential.Class != credentialClass || credential.FD != credentialInputFD || credential.Transport != "protected-fd" ||
		!stringSliceEqual(credential.Names, expected) || !sort.StringsAreSorted(credential.Names) {
		return errors.New("sealed credential binding differs from the exact phase allowlist")
	}
	return nil
}

func expectedCredentialNames(invocation invocation) ([]string, error) {
	surface, phase := invocation.Surface, invocation.Phase
	if surface == "takoform-core-release" {
		values := map[string][]string{
			"audit": {"GH_TOKEN"}, "sign-tag": {"TAKOFORM_CORE_TAG_SIGNING_KEY"},
			"publish": {"GH_TOKEN"}, "record-push": {"TAKOFORM_CORE_REF_WRITE_TOKEN"},
		}
		if names := values[phase]; names != nil {
			return names, nil
		}
	}
	if surface == "takoform-schema-origin" {
		for _, accepted := range []string{"prepare", "stage", "cutover", "prepare-activation", "verify", "revert"} {
			if phase == accepted {
				return []string{"CLOUDFLARE_API_TOKEN"}, nil
			}
		}
	}
	if surface == "takoform-specification-release" {
		lane := flagValue(invocation.Args, "--lane")
		var names []string
		switch {
		case phase == "prepare" && (lane == "schema" || lane == "composed"):
			names = []string{"CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID"}
		case (phase == "publish" || phase == "recover") && lane == "specification":
			names = []string{"GH_TOKEN", "TAKOFORM_CORE_TAG_SIGNING_KEY", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"}
		case (phase == "publish" || phase == "recover") && lane == "schema":
			names = []string{"CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"}
		case (phase == "publish" || phase == "recover") && lane == "composed":
			names = []string{"CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "GH_TOKEN", "TAKOFORM_CORE_TAG_SIGNING_KEY", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"}
		case phase == "prepare-receipt":
			names = []string{"TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"}
		case phase == "record":
			names = []string{"TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"}
		case phase == "verify" && lane != "schema":
			names = []string{"TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"}
		}
		if names != nil {
			sort.Strings(names)
			return names, nil
		}
	}
	return nil, errors.New("sealed invocation is not one exact credentialed phase")
}

func proposalIdentityEvidence(proposal *sealedProposal) (map[string]any, error) {
	runtimeRaw, err := canonicalJSON(proposal.Runtime)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"source.raw-source-tree-sha256":             proposal.Source.RawSourceTreeSHA256,
		"source.review-record-sha256":               proposal.Source.ReviewRecord.SHA256,
		"closure.closure-manifest-sha256":           proposal.Source.InventorySHA256,
		"closure.closure-tree-sha256":               proposal.Source.TreeSHA256,
		"runtime.runtime-executable-sha256":         proposal.Runtime.Node.SHA256,
		"runtime.runtime-dependency-closure-sha256": digestBytes(runtimeRaw),
		"launcher.launcher-executable-sha256":       proposal.Launcher.Broker.SHA256,
		"launcher.launcher-config-sha256":           proposal.Launcher.ConfigSHA256,
		"launcher.launcher-device":                  proposal.Launcher.Broker.Dev,
		"launcher.launcher-inode":                   proposal.Launcher.Broker.Ino,
		"launcher.launcher-owner-uid":               proposal.Launcher.Broker.UID,
		"launcher.launcher-owner-gid":               proposal.Launcher.Broker.GID,
		"launcher.launcher-mode":                    proposal.Launcher.Broker.Mode,
	}, nil
}

func requireExecutableIdentity(actual fileIdentity, expected executableIdentity, label string) error {
	if actual.Path != expected.Path || actual.SHA256 != expected.SHA256 || actual.Dev != expected.Dev || actual.Ino != expected.Ino ||
		actual.UID != expected.UID || actual.GID != expected.GID || actual.Mode != expected.Mode || actual.Nlink != expected.Nlink ||
		actual.Size != expected.Size || actual.MtimeMS != expected.MtimeMS {
		return fmt.Errorf("%s exact identity changed", label)
	}
	return nil
}

func sameProposalFileIdentity(actual fileIdentity, expected proposalFileIdentity) bool {
	return actual.Dev == expected.Dev && actual.Ino == expected.Ino && actual.UID == expected.UID && actual.GID == expected.GID &&
		actual.Mode == expected.Mode && actual.Nlink == expected.Nlink && actual.Size == expected.Size && actual.MtimeMS == expected.MtimeMS
}

func sameBoundIdentity(left, right proposalFileIdentity) bool {
	return left == right
}

func canonicalEqual(left, right any) bool {
	leftRaw, leftErr := canonicalJSON(left)
	rightRaw, rightErr := canonicalJSON(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftRaw, rightRaw)
}

func canonicalUTCTimestamp(value string) bool {
	if !strings.HasSuffix(value, "Z") {
		return false
	}
	instant, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	return err == nil && instant.UTC().Format("2006-01-02T15:04:05.000Z") == value
}

func stringSliceEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func invocationBindsInput(args []string, flag, path string) bool {
	count := 0
	for index := 0; index+1 < len(args); index++ {
		if args[index] == flag && args[index+1] == path {
			count++
		}
	}
	return count == 1
}

func pathWithin(root, path string) bool {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	relation, err := filepath.Rel(root, path)
	return err == nil && relation != "." && relation != ".." && !strings.HasPrefix(relation, "../") && !filepath.IsAbs(relation)
}

func flagValue(args []string, flag string) string {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == flag {
			return args[index+1]
		}
	}
	return ""
}

func toRunExecutable(identity executableIdentity) runExecutableIdentity {
	return runExecutableIdentity{
		Path: identity.Path, SHA256: identity.SHA256, Dev: identity.Dev, Ino: identity.Ino,
		UID: identity.UID, GID: identity.GID, Mode: identity.Mode,
	}
}
