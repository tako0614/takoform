package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/sys/unix"
)

type executionPathMapping struct {
	Kind       string `json:"kind"`
	Reviewed   string `json:"reviewed"`
	Execution  string `json:"execution"`
	TreeSHA256 string `json:"treeSha256,omitempty"`
	SHA256     string `json:"sha256,omitempty"`
}

type executionCopy struct {
	root          string
	sourceRoot    string
	runnerPath    string
	ephemeralRoot string
	invocation    invocation
	mappings      []executionPathMapping
	mappingSHA256 string
}

func prepareExecutionCopy(cfg config, stateFD int, validated *validatedProposal) (_ *executionCopy, resultErr error) {
	name, err := randomName("execution")
	if err != nil {
		return nil, err
	}
	if err := unix.Mkdirat(stateFD, name, 0o700); err != nil {
		return nil, fmt.Errorf("create broker-owned execution root: %w", err)
	}
	root := filepath.Join(cfg.stateRoot, name)
	defer func() {
		if resultErr != nil {
			_ = os.RemoveAll(root)
		}
	}()
	if directory, _, err := openExactDirectory(root, "broker-owned execution root", 0, 0, 0o700); err != nil {
		return nil, err
	} else {
		directory.Close()
	}
	sourceRoot := filepath.Join(root, "source")
	sourceInventory, err := copyReviewedClosure(validated.proposal.Source.Root, sourceRoot, validated.proposal.Source.Inventory)
	if err != nil {
		return nil, err
	}
	if err := verifyContentInventory(validated.proposal.Source.Inventory, sourceInventory, "broker-resealed source logical manifest"); err != nil {
		return nil, err
	}
	_, copiedTree, err := inventoryDigests(sourceInventory)
	if err != nil || copiedTree != validated.proposal.Source.TreeSHA256 {
		return nil, errors.New("broker-resealed source differs from the signed content-tree digest")
	}
	if err := validateDetachedGitMetadata(sourceRoot, validated.proposal.Source.Commit, sourceInventory); err != nil {
		return nil, err
	}

	inputsRoot := filepath.Join(root, "inputs")
	if err := os.Mkdir(inputsRoot, 0o700); err != nil || os.Chown(inputsRoot, 0, 0) != nil {
		return nil, errors.New("create broker-owned execution inputs")
	}
	mappings := []executionPathMapping{{Kind: "source", Reviewed: validated.proposal.Source.Root, Execution: sourceRoot, TreeSHA256: validated.proposal.Source.TreeSHA256}}
	for _, input := range validated.proposal.Inputs {
		relation, err := filepath.Rel(filepath.Join(validated.proposal.Root.Path, "inputs"), input.Path)
		if err != nil || relation == "." || relation == ".." || strings.HasPrefix(relation, "../") || filepath.IsAbs(relation) {
			return nil, errors.New("reviewed input path cannot be mapped into broker custody")
		}
		target := filepath.Join(inputsRoot, relation)
		switch input.Type {
		case "file":
			if err := copyReviewedFile(input.Path, target, input.Identity, input.SHA256, 0o400); err != nil {
				return nil, err
			}
			mappings = append(mappings, executionPathMapping{Kind: "file", Reviewed: input.Path, Execution: target, SHA256: input.SHA256})
		case "directory":
			copied, err := copyReviewedClosure(input.Path, target, input.Inventory)
			if err != nil {
				return nil, err
			}
			if err := verifyContentInventory(input.Inventory, copied, "broker-resealed directory input logical manifest"); err != nil {
				return nil, err
			}
			_, tree, err := inventoryDigests(copied)
			if err != nil || tree != input.TreeSHA256 {
				return nil, errors.New("broker-resealed directory input differs from signed content tree")
			}
			mappings = append(mappings, executionPathMapping{Kind: "directory", Reviewed: input.Path, Execution: target, TreeSHA256: input.TreeSHA256})
		default:
			return nil, errors.New("cannot reseal unknown input type")
		}
	}
	if err := os.Chmod(inputsRoot, 0o555); err != nil {
		return nil, fmt.Errorf("seal broker-owned execution inputs: %w", err)
	}
	ephemeralRoot := filepath.Join(root, "ephemeral")
	if err := os.Mkdir(ephemeralRoot, 0o700); err != nil || os.Chown(ephemeralRoot, 0, 0) != nil || os.Chmod(ephemeralRoot, 0o700) != nil {
		return nil, errors.New("create broker-owned ephemeral credential root")
	}
	sort.Slice(mappings, func(left, right int) bool { return mappings[left].Reviewed < mappings[right].Reviewed })
	mappingRaw, err := canonicalJSON(mappings)
	if err != nil {
		return nil, err
	}
	executedInvocation, err := rewriteInvocation(validated.proposal.Invocation, mappings)
	if err != nil {
		return nil, err
	}
	runnerPath := filepath.Join(sourceRoot, filepath.FromSlash(cfg.runnerRelativePath))
	runner, err := openStableRegularFile(runnerPath, "broker-resealed deploy runner", stableFilePolicy{
		maximum: maximumProposalBytes, exactMode: 0o444, exactUID: 0, exactGID: 0, exactNlink: 1,
	})
	if err != nil {
		return nil, err
	}
	if runner.identity.SHA256 != validated.proposal.Launcher.Runner.SHA256 {
		runner.close()
		return nil, errors.New("broker-resealed runner differs from signed bytes")
	}
	runner.close()
	// Close the producer-to-broker race window by re-reading the complete
	// original logical closure and every bound input after the copy is sealed.
	// The copied dev/inode/owner/mtime values intentionally differ, while the
	// reviewed original must still match its signed full identity manifest.
	original, err := inspectReviewedClosure(validated.proposal.Source.Root, "reviewed source after broker reseal")
	if err != nil {
		return nil, err
	}
	if err := verifyInventory(validated.proposal.Source.Inventory, original, "reviewed source after broker reseal inventory"); err != nil {
		return nil, err
	}
	manifest, tree, err := inventoryDigests(original)
	if err != nil || manifest != validated.proposal.Source.InventorySHA256 || tree != validated.proposal.Source.TreeSHA256 {
		return nil, errors.New("reviewed source changed while broker resealed it")
	}
	if err := validateDetachedGitMetadata(validated.proposal.Source.Root, validated.proposal.Source.Commit, original); err != nil {
		return nil, err
	}
	if err := validateBoundInputs(&validated.proposal, validated.broker); err != nil {
		return nil, err
	}
	return &executionCopy{
		root: root, sourceRoot: sourceRoot, runnerPath: runnerPath, ephemeralRoot: ephemeralRoot,
		invocation: executedInvocation, mappings: mappings, mappingSHA256: digestBytes(mappingRaw),
	}, nil
}

func copyReviewedClosure(sourceRoot, targetRoot string, expected []inventoryRecord) ([]inventoryRecord, error) {
	if err := os.Mkdir(targetRoot, 0o700); err != nil || os.Chown(targetRoot, 0, 0) != nil {
		return nil, errors.New("create broker-resealed closure root")
	}
	for _, entry := range expected {
		source := filepath.Join(sourceRoot, filepath.FromSlash(entry.Path))
		target := filepath.Join(targetRoot, filepath.FromSlash(entry.Path))
		switch entry.Type {
		case "directory":
			if err := os.Mkdir(target, 0o700); err != nil || os.Chown(target, 0, 0) != nil {
				return nil, fmt.Errorf("create broker-resealed directory %s", entry.Path)
			}
		case "file":
			identity := proposalFileIdentity{Dev: entry.Dev, Ino: entry.Ino, UID: entry.UID, GID: entry.GID, Mode: entry.Mode, Nlink: entry.Nlink, Size: entry.Size, MtimeMS: entry.MtimeMS}
			if err := copyReviewedFile(source, target, identity, entry.SHA256, entry.Mode); err != nil {
				return nil, err
			}
		case "symlink":
			var before unix.Stat_t
			if err := unix.Lstat(source, &before); err != nil || before.Mode&unix.S_IFMT != unix.S_IFLNK ||
				uint64(before.Dev) != entry.Dev || before.Ino != entry.Ino || before.Uid != entry.UID || before.Gid != entry.GID ||
				uint32(before.Mode&0o777) != entry.Mode || uint64(before.Nlink) != entry.Nlink ||
				(float64(before.Mtim.Sec)*1000+float64(before.Mtim.Nsec)/1_000_000) != entry.MtimeMS {
				return nil, fmt.Errorf("reviewed symlink %s changed before broker reseal", entry.Path)
			}
			targetValue, err := os.Readlink(source)
			if err != nil || targetValue != entry.Target {
				return nil, fmt.Errorf("reviewed symlink %s target changed before broker reseal", entry.Path)
			}
			var after unix.Stat_t
			if err := unix.Lstat(source, &after); err != nil || !sameStatIdentity(before, after) {
				return nil, fmt.Errorf("reviewed symlink %s changed while broker copied it", entry.Path)
			}
			if err := os.Symlink(targetValue, target); err != nil || os.Lchown(target, 0, 0) != nil {
				return nil, fmt.Errorf("copy reviewed symlink %s into broker custody", entry.Path)
			}
		default:
			return nil, fmt.Errorf("reviewed closure has unknown type %q", entry.Type)
		}
	}
	for index := len(expected) - 1; index >= 0; index-- {
		entry := expected[index]
		if entry.Type == "directory" {
			if err := os.Chmod(filepath.Join(targetRoot, filepath.FromSlash(entry.Path)), 0o555); err != nil {
				return nil, fmt.Errorf("seal broker-resealed directory %s: %w", entry.Path, err)
			}
		}
	}
	if err := os.Chmod(targetRoot, 0o555); err != nil {
		return nil, fmt.Errorf("seal broker-resealed closure root: %w", err)
	}
	return inspectClosure(targetRoot, "broker-resealed closure", 0, 0)
}

func copyReviewedFile(source, target string, expected proposalFileIdentity, expectedSHA256 string, targetMode uint32) error {
	file, err := openStableRegularFile(source, "reviewed file for broker reseal", stableFilePolicy{
		maximum: maximumClosureFileBytes, exactMode: expected.Mode, exactUID: expected.UID, exactGID: expected.GID, exactNlink: expected.Nlink,
		allowEmpty: true,
	})
	if err != nil {
		return err
	}
	defer file.close()
	if !sameProposalFileIdentity(file.identity, expected) || file.identity.SHA256 != expectedSHA256 {
		return errors.New("reviewed file changed before broker reseal")
	}
	targetFile, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, os.FileMode(targetMode))
	if err != nil {
		return fmt.Errorf("create broker-resealed file: %w", err)
	}
	success := false
	defer func() {
		if targetFile != nil {
			targetFile.Close()
		}
		if !success {
			_ = os.Remove(target)
		}
	}()
	if err := targetFile.Chown(0, 0); err != nil || targetFile.Chmod(os.FileMode(targetMode)) != nil {
		return errors.New("set broker-resealed file custody")
	}
	if _, err := targetFile.Write(file.raw); err != nil || targetFile.Sync() != nil {
		return errors.New("write broker-resealed file")
	}
	if err := targetFile.Close(); err != nil {
		return fmt.Errorf("close broker-resealed file: %w", err)
	}
	targetFile = nil
	sealed, err := openStableRegularFile(target, "broker-resealed file", stableFilePolicy{
		maximum: maximumClosureFileBytes, exactMode: targetMode, exactUID: 0, exactGID: 0, exactNlink: 1,
		allowEmpty: true,
	})
	if err != nil {
		return err
	}
	defer sealed.close()
	if sealed.identity.SHA256 != expectedSHA256 {
		return errors.New("broker-resealed file differs from reviewed bytes")
	}
	success = true
	return nil
}

func verifyContentInventory(reviewed, copied []inventoryRecord, label string) error {
	if len(reviewed) != len(copied) {
		return fmt.Errorf("%s record count differs", label)
	}
	for index := range reviewed {
		left, right := reviewed[index], copied[index]
		if left.Path != right.Path || left.Type != right.Type || left.Mode != right.Mode {
			return fmt.Errorf("%s type/path/mode differs at %s", label, left.Path)
		}
		switch left.Type {
		case "file":
			if left.Size != right.Size || left.SHA256 != right.SHA256 {
				return fmt.Errorf("%s file bytes differ at %s", label, left.Path)
			}
		case "symlink":
			if left.Target != right.Target {
				return fmt.Errorf("%s symlink target differs at %s", label, left.Path)
			}
		case "directory":
		default:
			return fmt.Errorf("%s unknown type at %s", label, left.Path)
		}
		if right.UID != 0 || right.GID != 0 || (right.Type != "directory" && right.Nlink != 1) {
			return fmt.Errorf("%s copied custody differs at %s", label, left.Path)
		}
	}
	return nil
}

func rewriteInvocation(reviewed invocation, mappings []executionPathMapping) (invocation, error) {
	executed := invocation{Surface: reviewed.Surface, Phase: reviewed.Phase, Args: append([]string{}, reviewed.Args...)}
	sorted := append([]executionPathMapping{}, mappings...)
	sort.Slice(sorted, func(left, right int) bool { return len(sorted[left].Reviewed) > len(sorted[right].Reviewed) })
	for index, value := range executed.Args {
		for _, mapping := range sorted {
			if value == mapping.Reviewed {
				executed.Args[index] = mapping.Execution
				break
			}
			prefix := mapping.Reviewed + string(filepath.Separator)
			if strings.HasPrefix(value, prefix) {
				executed.Args[index] = filepath.Join(mapping.Execution, strings.TrimPrefix(value, prefix))
				break
			}
		}
	}
	raw, err := canonicalJSON(map[string]any{"args": executed.Args, "phase": executed.Phase, "surface": executed.Surface})
	if err != nil {
		return invocation{}, err
	}
	executed.SHA256 = digestBytes(raw)
	return executed, nil
}
