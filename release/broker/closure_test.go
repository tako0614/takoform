package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryArtifactClosureIncludesFilesDirectoriesAndInternalSymlinks(t *testing.T) {
	root := filepath.Join(t.TempDir(), "artifact")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, "nested")
	if err := os.Mkdir(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(directory, "artifact.json")
	if err := os.WriteFile(file, []byte("artifact\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(file, 0o444); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("nested/artifact.json", filepath.Join(root, "current")); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(directory, 0o555); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0o555); err != nil {
		t.Fatal(err)
	}
	inventory, err := inspectClosure(root, "directory artifact", uint32(os.Getuid()), uint32(os.Getgid()))
	if err != nil {
		t.Fatalf("valid directory artifact was rejected: %v", err)
	}
	if len(inventory) != 3 || inventory[0].Path != "current" || inventory[0].Type != "symlink" ||
		inventory[1].Path != "nested" || inventory[1].Type != "directory" ||
		inventory[2].Path != "nested/artifact.json" || inventory[2].Type != "file" {
		t.Fatalf("unexpected closure inventory: %#v", inventory)
	}
	manifest, tree, err := inventoryDigests(inventory)
	if err != nil || !digestPattern.MatchString(manifest) || !digestPattern.MatchString(tree) {
		t.Fatalf("closure digests are invalid: %q %q %v", manifest, tree, err)
	}

	if err := os.Chmod(file, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectClosure(root, "changed directory artifact", uint32(os.Getuid()), uint32(os.Getgid())); err == nil {
		t.Fatal("changed artifact mode was accepted")
	}
}

func TestClosureRejectsEscapingSymlink(t *testing.T) {
	root := filepath.Join(t.TempDir(), "closure")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../outside", filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0o555); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectClosure(root, "closure", uint32(os.Getuid()), uint32(os.Getgid())); err == nil {
		t.Fatal("escaping symlink was accepted")
	}
}
