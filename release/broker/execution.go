package main

import (
	"bytes"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

const (
	consumeMarkerFormat = "takoform.broker-capability-consume-marker@v1"
	maximumChildOutput  = 16 * 1024 * 1024
)

func executeValidated(cfg config, validated *validatedProposal, credentialMetadata fileIdentity) (resultErr error) {
	state, _, err := openExactDirectory(cfg.stateRoot, "sealed broker state root", 0, 0, 0o700)
	if err != nil {
		return err
	}
	defer state.Close()
	execution, err := prepareExecutionCopy(cfg, int(state.Fd()), validated)
	if err != nil {
		return err
	}
	defer func() {
		resultErr = combineCleanupError(resultErr, cleanupEphemeralRoot(cfg, execution.root))
	}()
	if err := revalidateExecutionCopy(cfg, validated, execution); err != nil {
		return err
	}
	capability, capabilityRaw, capabilitySHA256, err := mintInternalCapability(validated, execution)
	if err != nil {
		return err
	}
	defer func() {
		capability.Nonce = ""
		zeroBytes(capabilityRaw)
	}()
	markerRaw, markerSHA256, err := persistConsumeMarker(int(state.Fd()), validated, execution, capabilitySHA256)
	if err != nil {
		return err
	}
	_ = markerRaw // The marker remains broker-private; only its digest is attested.

	credentialRaw, after, err := readAllFDStable(cfg.credentialFD, "broker credential input", maximumCredentialBytes, 0, 0, 0o600, 1)
	if err != nil {
		return err
	}
	if !sameCredentialFDMetadata(credentialMetadata, after) {
		zeroBytes(credentialRaw)
		return errors.New("broker credential FD identity changed after capability consume")
	}
	_ = unix.Close(cfg.credentialFD)
	defer zeroBytes(credentialRaw)
	credentials, err := validateCredentialEnvelope(credentialRaw, validated.proposal.Credential.Names)
	if err != nil {
		return err
	}
	defer zeroCredentialValues(credentials)

	runRequest := makeRunRequest(validated, execution, capabilitySHA256, markerSHA256)
	runRequestRaw, err := canonicalJSONLine(runRequest)
	if err != nil {
		return err
	}
	runFD, err := createUnlinkedProtectedFile(int(state.Fd()), "run-request", runRequestRaw, 0o400)
	if err != nil {
		return err
	}
	defer runFD.Close()
	credentialFD, err := createUnlinkedProtectedFile(int(state.Fd()), "credential", credentialRaw, 0o600)
	if err != nil {
		return err
	}
	defer credentialFD.Close()

	if err := revalidateExecutionCopy(cfg, validated, execution); err != nil {
		return err
	}
	return spawnSealedRunner(cfg, execution, runFD, credentialFD, credentials)
}

func cleanupEphemeralRoot(cfg config, path string) error {
	cleanup := cfg.removeAll
	if cleanup == nil {
		cleanup = os.RemoveAll
	}
	if err := cleanup(path); err != nil {
		return fmt.Errorf("broker ephemeral-root cleanup failed: %w", err)
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return errors.New("broker ephemeral root survived cleanup")
	}
	return nil
}

func combineCleanupError(operation, cleanup error) error {
	if cleanup == nil {
		return operation
	}
	if operation == nil {
		return cleanup
	}
	return fmt.Errorf("%v; %w", operation, cleanup)
}

func validateCredentialFDMetadata(fd int) (fileIdentity, error) {
	flags, err := unix.FcntlInt(uintptr(fd), unix.F_GETFL, 0)
	if err != nil || flags&unix.O_ACCMODE != unix.O_RDONLY {
		return fileIdentity{}, errors.New("broker credential FD must be inherited read-only")
	}
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		return fileIdentity{}, fmt.Errorf("stat broker credential FD: %w", err)
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Uid != 0 || stat.Gid != 0 || uint32(stat.Mode&0o777) != 0o600 ||
		uint64(stat.Nlink) != 1 || stat.Size <= 0 || stat.Size > maximumCredentialBytes {
		return fileIdentity{}, errors.New("broker credential FD is not one root:root mode 0600 nlink1 regular file")
	}
	if _, err := unix.FcntlInt(uintptr(fd), unix.F_SETFD, unix.FD_CLOEXEC); err != nil {
		return fileIdentity{}, fmt.Errorf("seal broker credential FD close-on-exec: %w", err)
	}
	descriptorFlags, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0)
	if err != nil || descriptorFlags&unix.FD_CLOEXEC == 0 {
		return fileIdentity{}, errors.New("broker credential FD close-on-exec seal did not hold")
	}
	return identityFromStat("", stat), nil
}

func sameCredentialFDMetadata(left, right fileIdentity) bool {
	return left.Dev == right.Dev && left.Ino == right.Ino && left.UID == right.UID && left.GID == right.GID &&
		left.Mode == right.Mode && left.Nlink == right.Nlink && left.Size == right.Size && left.MtimeMS == right.MtimeMS
}

func validateCredentialEnvelope(raw []byte, expectedNames []string) (map[string][]byte, error) {
	var values map[string]string
	if _, err := parseCanonicalJSON(raw, maximumCredentialBytes, "broker credential envelope", &values); err != nil {
		return nil, err
	}
	if len(values) != len(expectedNames) {
		return nil, errors.New("broker credential envelope has extra or missing phase keys")
	}
	result := make(map[string][]byte, len(values))
	for _, name := range expectedNames {
		value, exists := values[name]
		if !exists || value == "" || strings.ContainsRune(value, 0) {
			return nil, fmt.Errorf("broker credential envelope has invalid value for %s", name)
		}
		result[name] = []byte(value)
		values[name] = ""
	}
	return result, nil
}

func zeroCredentialValues(values map[string][]byte) {
	for _, value := range values {
		zeroBytes(value)
	}
}

func persistConsumeMarker(stateFD int, validated *validatedProposal, execution *executionCopy, capabilitySHA256 string) ([]byte, string, error) {
	marker := consumeMarker{
		Format: consumeMarkerFormat, ProposalSHA256: validated.proposalSHA256,
		SignedReviewSHA256: validated.reviewSHA256, NonceSHA256: digestBytes([]byte(validated.proposal.Nonce)),
		CapabilityEnvelopeSHA256:  capabilitySHA256,
		BrokerIdentitySHA256:      validated.brokerIdentitySHA,
		ReviewedInvocationSHA256:  validated.proposal.Invocation.SHA256,
		ExecutionInvocationSHA256: execution.invocation.SHA256,
		ExecutionMappingSHA256:    execution.mappingSHA256,
	}
	raw, err := canonicalJSONLine(marker)
	if err != nil {
		return nil, "", err
	}
	name := "consumed-" + strings.TrimPrefix(marker.NonceSHA256, "sha256:") + ".json"
	fd, err := unix.Openat(stateFD, name, unix.O_RDWR|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0o400)
	if errors.Is(err, unix.EEXIST) {
		return nil, "", errors.New("sealed continuation nonce replay refused")
	}
	if err != nil {
		return nil, "", fmt.Errorf("atomically consume sealed continuation nonce: %w", err)
	}
	defer func() {
		unix.Close(fd)
	}()
	if err := unix.Fchown(fd, 0, 0); err != nil || unix.Fchmod(fd, 0o400) != nil {
		return nil, "", errors.New("seal capability consume marker custody")
	}
	if err := writeFull(fd, raw); err != nil || unix.Fsync(fd) != nil {
		return nil, "", errors.New("persist capability consume marker")
	}
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil || stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Uid != 0 || stat.Gid != 0 ||
		uint32(stat.Mode&0o777) != 0o400 || stat.Nlink != 1 || stat.Size != int64(len(raw)) {
		return nil, "", errors.New("capability consume marker lost exact root:root mode 0400 custody")
	}
	verified := make([]byte, len(raw))
	read := 0
	for read < len(verified) {
		count, err := unix.Pread(fd, verified[read:], int64(read))
		if err != nil || count == 0 {
			return nil, "", errors.New("re-read persisted capability consume marker")
		}
		read += count
	}
	if !exactBytes(raw, verified) {
		return nil, "", errors.New("persisted capability consume marker bytes differ")
	}
	if err := unix.Fsync(stateFD); err != nil {
		return nil, "", errors.New("sync capability consume marker directory")
	}
	return raw, digestBytes(raw), nil
}

func writeFull(fd int, raw []byte) error {
	for len(raw) > 0 {
		count, err := unix.Write(fd, raw)
		if err != nil {
			return err
		}
		if count == 0 {
			return io.ErrShortWrite
		}
		raw = raw[count:]
	}
	return nil
}

func createUnlinkedProtectedFile(stateFD int, prefix string, raw []byte, mode uint32) (*os.File, error) {
	for attempt := 0; attempt < 32; attempt++ {
		name, err := randomName(prefix)
		if err != nil {
			return nil, err
		}
		writeFD, err := unix.Openat(stateFD, name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, mode)
		if errors.Is(err, unix.EEXIST) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("create protected %s: %w", prefix, err)
		}
		if err := unix.Fchown(writeFD, 0, 0); err != nil || unix.Fchmod(writeFD, mode) != nil || writeFull(writeFD, raw) != nil || unix.Fsync(writeFD) != nil {
			unix.Close(writeFD)
			_ = unix.Unlinkat(stateFD, name, 0)
			return nil, fmt.Errorf("write protected %s", prefix)
		}
		unix.Close(writeFD)
		readFD, err := unix.Openat(stateFD, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if err != nil {
			_ = unix.Unlinkat(stateFD, name, 0)
			return nil, fmt.Errorf("reopen protected %s read-only: %w", prefix, err)
		}
		var before unix.Stat_t
		if err := unix.Fstat(readFD, &before); err != nil || before.Mode&unix.S_IFMT != unix.S_IFREG || before.Uid != 0 || before.Gid != 0 ||
			uint32(before.Mode&0o777) != mode || before.Nlink != 1 || before.Size != int64(len(raw)) {
			unix.Close(readFD)
			_ = unix.Unlinkat(stateFD, name, 0)
			return nil, fmt.Errorf("protected %s lost exact linked custody", prefix)
		}
		if err := unix.Unlinkat(stateFD, name, 0); err != nil {
			unix.Close(readFD)
			return nil, fmt.Errorf("unlink protected %s: %w", prefix, err)
		}
		var after unix.Stat_t
		if err := unix.Fstat(readFD, &after); err != nil || after.Nlink != 0 || before.Dev != after.Dev || before.Ino != after.Ino ||
			before.Uid != after.Uid || before.Gid != after.Gid || before.Mode != after.Mode || before.Size != after.Size {
			unix.Close(readFD)
			return nil, fmt.Errorf("protected %s lost unlinked FD custody", prefix)
		}
		return os.NewFile(uintptr(readFD), prefix), nil
	}
	return nil, fmt.Errorf("cannot allocate protected %s", prefix)
}

func randomName(prefix string) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("read broker randomness: %w", err)
	}
	return fmt.Sprintf("%s-%x", prefix, raw), nil
}

// mintInternalCapability hashes the complete canonical capability preimage.
// The preimage deliberately contains neither its own digest nor the later
// consume-marker digest, so the capability is immutable and non-self-referential.
func mintInternalCapability(validated *validatedProposal, execution *executionCopy) (*internalCapability, []byte, string, error) {
	evidence := map[string]any{
		"reviewer-public-key-sha256":        validated.trust.fileSHA256,
		"review-signature-algorithm":        validated.sshsig.algorithm,
		"review-signature-bytes":            validated.sshsig.signatureSHA256,
		"signed-review-envelope-sha256":     validated.reviewSHA256,
		"proposal-envelope-sha256":          validated.proposalSHA256,
		"broker-identity-envelope-sha256":   validated.brokerIdentitySHA,
		"broker-executable-sha256":          validated.broker.SHA256,
		"broker-device":                     validated.broker.Dev,
		"broker-inode":                      validated.broker.Ino,
		"broker-owner-uid":                  validated.broker.UID,
		"broker-owner-gid":                  validated.broker.GID,
		"broker-mode":                       validated.broker.Mode,
		"broker-static-build-id-sha256":     validated.broker.StaticBuildID_SHA256,
		"launcher-executable-sha256":        validated.proposal.Launcher.Broker.SHA256,
		"launcher-config-sha256":            validated.proposal.Launcher.ConfigSHA256,
		"launcher-device":                   validated.proposal.Launcher.Broker.Dev,
		"launcher-inode":                    validated.proposal.Launcher.Broker.Ino,
		"launcher-owner-uid":                validated.proposal.Launcher.Broker.UID,
		"launcher-owner-gid":                validated.proposal.Launcher.Broker.GID,
		"launcher-mode":                     validated.proposal.Launcher.Broker.Mode,
		"raw-source-tree-sha256":            validated.proposal.Source.RawSourceTreeSHA256,
		"review-record-sha256":              validated.proposal.Source.ReviewRecord.SHA256,
		"closure-manifest-sha256":           validated.proposal.Source.InventorySHA256,
		"closure-tree-sha256":               validated.proposal.Source.TreeSHA256,
		"runtime-executable-sha256":         validated.proposal.Runtime.Node.SHA256,
		"runtime-dependency-closure-sha256": validated.proposal.IdentityEvidence["runtime.runtime-dependency-closure-sha256"],
		"invocation-envelope-sha256":        validated.proposal.Invocation.SHA256,
		"nonce-sha256":                      digestBytes([]byte(validated.proposal.Nonce)),
	}
	capability := &internalCapability{
		Format: capabilityFormat, ProposalSHA256: validated.proposalSHA256, SignedReviewSHA256: validated.reviewSHA256,
		Source:                   runSource{Commit: validated.proposal.Source.Commit, Root: execution.sourceRoot},
		Invocation:               execution.invocation,
		ReviewedInvocationSHA256: validated.proposal.Invocation.SHA256,
		ExecutionMappingSHA256:   execution.mappingSHA256,
		Credential:               runCredential{Class: validated.proposal.Credential.Class, Names: append([]string{}, validated.proposal.Credential.Names...)},
		Broker:                   validated.broker, Runtime: runRuntime{Node: validated.runtimeNode}, EphemeralRoot: execution.ephemeralRoot,
		IdentityEvidence: validated.proposal.IdentityEvidence, AuthenticityEvidence: evidence, Nonce: validated.proposal.Nonce,
	}
	projection, err := canonicalJSONLine(capability)
	if err != nil {
		return nil, nil, "", err
	}
	digest := digestBytes(projection)
	return capability, projection, digest, nil
}

func makeRunRequest(validated *validatedProposal, execution *executionCopy, capabilitySHA256, markerSHA256 string) runRequest {
	request := runRequest{
		Format: runRequestFormat, ProposalEnvelopeSHA256: validated.proposalSHA256,
		ReviewRecordSHA256: validated.reviewSHA256,
		Source:             runSource{Commit: validated.proposal.Source.Commit, Root: execution.sourceRoot},
		Invocation:         execution.invocation,
		Credential:         runCredential{Class: validated.proposal.Credential.Class, Names: append([]string{}, validated.proposal.Credential.Names...)},
		Broker:             validated.broker, Runtime: runRuntime{Node: validated.runtimeNode}, EphemeralRoot: execution.ephemeralRoot,
		IdentityEvidence: validated.proposal.IdentityEvidence,
	}
	request.Attestation.SignedReviewEnvelopeSHA256 = validated.reviewSHA256
	request.Attestation.CapabilityEnvelopeSHA256 = capabilitySHA256
	request.Attestation.CapabilityConsumeMarkerSHA256 = markerSHA256
	return request
}

func revalidateExecutionCopy(cfg config, validated *validatedProposal, execution *executionCopy) error {
	if _, err := validateBrokerSelf(cfg, validated.proposal.Launcher.Broker); err != nil {
		return err
	}
	if err := validateRuntime(cfg, &validated.proposal); err != nil {
		return err
	}
	if err := revalidateExecutionLayout(validated, execution); err != nil {
		return err
	}
	actual, err := inspectClosure(execution.sourceRoot, "broker-resealed source pre-exec", 0, 0)
	if err != nil {
		return err
	}
	if err := verifyContentInventory(validated.proposal.Source.Inventory, actual, "broker-resealed source pre-exec logical manifest"); err != nil {
		return err
	}
	_, tree, err := inventoryDigests(actual)
	if err != nil || tree != validated.proposal.Source.TreeSHA256 {
		return errors.New("broker-resealed pre-exec source tree changed")
	}
	runner, err := openStableRegularFile(execution.runnerPath, "broker-resealed runner pre-exec", stableFilePolicy{
		maximum: maximumProposalBytes, exactMode: 0o444, exactUID: 0, exactGID: 0, exactNlink: 1,
	})
	if err != nil {
		return err
	}
	defer runner.close()
	if runner.identity.SHA256 != validated.proposal.Launcher.Runner.SHA256 {
		return errors.New("broker-resealed runner changed before execution")
	}
	return nil
}

func revalidateExecutionLayout(validated *validatedProposal, execution *executionCopy) error {
	root, _, err := openExactDirectory(execution.root, "broker execution root pre-exec", 0, 0, 0o700)
	if err != nil {
		return err
	}
	root.Close()
	entries, err := os.ReadDir(execution.root)
	if err != nil || len(entries) != 3 || entries[0].Name() != "ephemeral" || entries[1].Name() != "inputs" || entries[2].Name() != "source" {
		return errors.New("broker execution root has an open or changed layout")
	}
	inputsRoot := filepath.Join(execution.root, "inputs")
	inputs, _, err := openExactDirectory(inputsRoot, "broker execution inputs pre-exec", 0, 0, 0o555)
	if err != nil {
		return err
	}
	inputs.Close()
	ephemeral, _, err := openExactDirectory(execution.ephemeralRoot, "broker ephemeral root pre-exec", 0, 0, 0o700)
	if err != nil {
		return err
	}
	ephemeral.Close()
	ephemeralEntries, err := os.ReadDir(execution.ephemeralRoot)
	if err != nil || len(ephemeralEntries) != 0 {
		return errors.New("broker ephemeral root is not empty before the sealed runner")
	}
	mappingRaw, err := canonicalJSON(execution.mappings)
	if err != nil || digestBytes(mappingRaw) != execution.mappingSHA256 {
		return errors.New("broker execution mapping changed")
	}
	expectedInvocation, err := rewriteInvocation(validated.proposal.Invocation, execution.mappings)
	if err != nil || !canonicalEqual(expectedInvocation, execution.invocation) {
		return errors.New("broker execution invocation mapping changed")
	}
	if len(execution.mappings) != len(validated.proposal.Inputs)+1 {
		return errors.New("broker execution mapping count changed")
	}
	boundInputs := make(map[string]boundInput, len(validated.proposal.Inputs))
	for _, input := range validated.proposal.Inputs {
		boundInputs[input.Path] = input
	}
	seen := make(map[string]struct{}, len(execution.mappings))
	for _, mapping := range execution.mappings {
		if _, exists := seen[mapping.Reviewed]; exists {
			return errors.New("broker execution mapping repeats a reviewed path")
		}
		seen[mapping.Reviewed] = struct{}{}
		if mapping.Kind == "source" {
			if mapping.Reviewed != validated.proposal.Source.Root || mapping.Execution != execution.sourceRoot ||
				mapping.TreeSHA256 != validated.proposal.Source.TreeSHA256 || mapping.SHA256 != "" {
				return errors.New("broker execution source mapping changed")
			}
			continue
		}
		input, exists := boundInputs[mapping.Reviewed]
		if !exists || input.Type != mapping.Kind {
			return errors.New("broker execution input mapping is not reviewed")
		}
		relation, err := filepath.Rel(filepath.Join(validated.proposal.Root.Path, "inputs"), input.Path)
		expectedPath := filepath.Join(inputsRoot, relation)
		if err != nil || mapping.Execution != expectedPath || !pathWithin(inputsRoot, mapping.Execution) {
			return errors.New("broker execution input mapping escaped private custody")
		}
		switch input.Type {
		case "file":
			if mapping.SHA256 != input.SHA256 || mapping.TreeSHA256 != "" {
				return errors.New("broker execution file mapping digest changed")
			}
			file, err := openStableRegularFile(mapping.Execution, "broker-resealed input file pre-exec", stableFilePolicy{
				maximum: maximumClosureFileBytes, exactMode: 0o400, exactUID: 0, exactGID: 0, exactNlink: 1,
			})
			if err != nil {
				return err
			}
			matches := file.identity.SHA256 == input.SHA256
			file.close()
			if !matches {
				return errors.New("broker-resealed input file changed before execution")
			}
		case "directory":
			if mapping.TreeSHA256 != input.TreeSHA256 || mapping.SHA256 != "" {
				return errors.New("broker execution directory mapping digest changed")
			}
			inventory, err := inspectClosure(mapping.Execution, "broker-resealed directory input pre-exec", 0, 0)
			if err != nil {
				return err
			}
			if err := verifyContentInventory(input.Inventory, inventory, "broker-resealed directory input pre-exec logical manifest"); err != nil {
				return err
			}
			_, tree, err := inventoryDigests(inventory)
			if err != nil || tree != input.TreeSHA256 {
				return errors.New("broker-resealed directory input changed before execution")
			}
		default:
			return errors.New("broker execution mapping has an unknown kind")
		}
	}
	return nil
}

func spawnSealedRunner(cfg config, execution *executionCopy, runFD, credentialFD *os.File, credentials map[string][]byte) error {
	command := exec.Command(cfg.nodePath, execution.runnerPath,
		"--broker-run-request-fd", "3", "--broker-credential-fd", "4")
	command.Env = []string{}
	command.Dir = execution.sourceRoot
	command.Stdin = nil
	command.ExtraFiles = []*os.File{runFD, credentialFD}
	command.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
	stdout := &secureOutputBuffer{maximum: maximumChildOutput}
	stderr := &secureOutputBuffer{maximum: maximumChildOutput}
	defer func() { zeroBytes(stdout.buffer.Bytes()) }()
	defer func() { zeroBytes(stderr.buffer.Bytes()) }()
	command.Stdout = stdout
	command.Stderr = stderr
	runErr := command.Run()
	if stdout.exceeded || stderr.exceeded {
		return errors.New("sealed runner output exceeded its closed bound")
	}
	if err := writeRedacted(cfg.stdout, stdout.buffer.Bytes(), credentials); err != nil {
		return fmt.Errorf("write sealed runner output: %w", err)
	}
	if err := writeRedacted(cfg.stderr, stderr.buffer.Bytes(), credentials); err != nil {
		return fmt.Errorf("write sealed runner diagnostics: %w", err)
	}
	if runErr != nil {
		var exitError *exec.ExitError
		if errors.As(runErr, &exitError) {
			return fmt.Errorf("sealed runner failed with exit status %d", exitError.ExitCode())
		}
		return fmt.Errorf("start sealed runner: %w", runErr)
	}
	return nil
}

type secureOutputBuffer struct {
	buffer   bytes.Buffer
	maximum  int
	exceeded bool
}

func (buffer *secureOutputBuffer) Write(raw []byte) (int, error) {
	if buffer.exceeded {
		return len(raw), nil
	}
	remaining := buffer.maximum - buffer.buffer.Len()
	if len(raw) > remaining {
		if remaining > 0 {
			_, _ = buffer.buffer.Write(raw[:remaining])
		}
		buffer.exceeded = true
		return len(raw), nil
	}
	return buffer.buffer.Write(raw)
}

func writeRedacted(writer io.Writer, raw []byte, credentials map[string][]byte) error {
	if writer == nil || len(raw) == 0 {
		return nil
	}
	redacted := bytes.Clone(raw)
	for _, secret := range credentials {
		if len(secret) != 0 {
			redacted = bytes.ReplaceAll(redacted, secret, []byte("[REDACTED]"))
		}
	}
	_, err := writer.Write(redacted)
	zeroBytes(redacted)
	return err
}
