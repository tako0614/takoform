package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBrokerResealPreservesSignedLogicalContentButChangesFilesystemManifestToRootCustody(t *testing.T) {
	parent := t.TempDir()
	source := filepath.Join(parent, "reviewed")
	if err := os.Mkdir(source, 0o755); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(source, "nested")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(nested, "artifact.json")
	if err := os.WriteFile(file, []byte("reviewed bytes\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	empty := filepath.Join(source, "empty")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("nested/artifact.json", filepath.Join(source, "current")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{file, empty} {
		if err := os.Chown(path, 65534, 65534); err != nil || os.Chmod(path, 0o444) != nil {
			t.Fatalf("prepare unprivileged file: %v", err)
		}
	}
	if err := os.Lchown(filepath.Join(source, "current"), 65534, 65534); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{nested, source} {
		if err := os.Chown(path, 65534, 65534); err != nil || os.Chmod(path, 0o555) != nil {
			t.Fatalf("prepare unprivileged directory: %v", err)
		}
	}
	reviewed, err := inspectReviewedClosure(source, "reviewed unprivileged closure")
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(parent, "broker-copy")
	copied, err := copyReviewedClosure(source, target, reviewed)
	if err != nil {
		t.Fatalf("broker reseal failed: %v", err)
	}
	if err := verifyContentInventory(reviewed, copied, "resealed logical records"); err != nil {
		t.Fatal(err)
	}
	reviewedManifest, reviewedTree, err := inventoryDigests(reviewed)
	if err != nil {
		t.Fatal(err)
	}
	copiedManifest, copiedTree, err := inventoryDigests(copied)
	if err != nil {
		t.Fatal(err)
	}
	if reviewedManifest == copiedManifest {
		t.Fatal("copied full filesystem manifest unexpectedly retained unprivileged dev/inode/uid/gid/mtime identities")
	}
	if reviewedTree != copiedTree {
		t.Fatalf("broker copy changed the signed content tree: %s != %s", reviewedTree, copiedTree)
	}
	for _, entry := range copied {
		if entry.UID != 0 || entry.GID != 0 {
			t.Fatalf("broker copy is not root-owned: %#v", entry)
		}
	}
}

func TestBrokerResealRefusesMutationAfterReviewedInventory(t *testing.T) {
	parent := t.TempDir()
	source := filepath.Join(parent, "reviewed")
	if err := os.Mkdir(source, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(source, "artifact")
	if err := os.WriteFile(file, []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(file, 0o444); err != nil || os.Chmod(source, 0o555) != nil {
		t.Fatal(err)
	}
	reviewed, err := inspectReviewedClosure(source, "reviewed closure")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(source, 0o755); err != nil || os.Chmod(file, 0o644) != nil || os.WriteFile(file, []byte("after\n"), 0o644) != nil || os.Chmod(file, 0o444) != nil || os.Chmod(source, 0o555) != nil {
		t.Fatal(err)
	}
	if _, err := copyReviewedClosure(source, filepath.Join(parent, "copy"), reviewed); err == nil {
		t.Fatal("mutated reviewed closure was copied into broker custody")
	}
}

func TestExecutionInvocationRewritesOnlyReviewedClosurePaths(t *testing.T) {
	reviewed := invocation{Surface: "takoform-core-release", Phase: "publish", Args: []string{
		"takoform-core-release", "publish", "--qualification", "/proposal/inputs/q.json", "--output", "/operator/output.json",
	}}
	mappings := []executionPathMapping{{Kind: "file", Reviewed: "/proposal/inputs/q.json", Execution: "/state/execution/inputs/q.json"}}
	executed, err := rewriteInvocation(reviewed, mappings)
	if err != nil {
		t.Fatal(err)
	}
	if executed.Args[3] != "/state/execution/inputs/q.json" || executed.Args[5] != "/operator/output.json" || !digestPattern.MatchString(executed.SHA256) {
		t.Fatalf("execution mapping was not exact: %#v", executed)
	}
}
