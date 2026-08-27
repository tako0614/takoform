package genericconformance

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestVerifyCorpus(t *testing.T) {
	report, err := VerifyManifest(filepath.Join("..", "conformance", "takoform-v1", "generic.json"))
	if err != nil {
		t.Fatal(err)
	}
	if report.Status != "passed" || report.Format != ReportFormat {
		t.Fatalf("report identity = %#v", report)
	}
	if len(report.Snapshots) != 2 {
		t.Fatalf("snapshot reports = %d, want 2", len(report.Snapshots))
	}
	if report.Snapshots[0].Name != "external-family" || len(report.Snapshots[0].FormRefs) != 20 {
		t.Fatalf("external report = %#v", report.Snapshots[0])
	}
	zero := report.Snapshots[1]
	if zero.Name != "zero-family" || len(zero.FormRefs) != 0 || len(zero.Interfaces) != 0 || len(zero.Bindings) != 0 || len(zero.Defaults) != 0 {
		t.Fatalf("zero report = %#v", zero)
	}
}

func TestVerifyRejectsTamperedDigestPathAndDuplicate(t *testing.T) {
	tests := []struct {
		name string
		edit func(*Manifest)
		want string
	}{
		{
			name: "digest",
			edit: func(manifest *Manifest) {
				manifest.SnapshotInputs[0].Packages[0].PackageDigest = "sha256:" + strings.Repeat("0", 64)
			},
			want: "digest",
		},
		{
			name: "path traversal",
			edit: func(manifest *Manifest) {
				manifest.SnapshotInputs[0].Packages[0].Path = "../package-index.json"
			},
			want: "traversal",
		},
		{
			name: "duplicate",
			edit: func(manifest *Manifest) {
				manifest.SnapshotInputs[0].Packages = append(manifest.SnapshotInputs[0].Packages, manifest.SnapshotInputs[0].Packages[0])
			},
			want: "repeats",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root, manifest := copiedCorpus(t)
			test.edit(&manifest)
			writeManifest(t, filepath.Join(root, "generic.json"), manifest)
			report, err := VerifyManifest(filepath.Join(root, "generic.json"))
			if err == nil || report.Status != "failed" || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("VerifyManifest = %#v, %v; want failure containing %q", report, err, test.want)
			}
		})
	}
}

func TestVerifyRejectsSymlinkAndNonCorpusFields(t *testing.T) {
	root, manifest := copiedCorpus(t)
	link := filepath.Join(root, "generic-host", "external-family", "alias")
	if err := os.Symlink("assigned-counter", link); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}
	manifest.SnapshotInputs[0].Packages[0].Path = "generic-host/external-family/alias/package-index.json"
	writeManifest(t, filepath.Join(root, "generic.json"), manifest)
	if _, err := VerifyManifest(filepath.Join(root, "generic.json")); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("symlink path was accepted: %v", err)
	}

	root, _ = copiedCorpus(t)
	var document map[string]any
	raw, err := os.ReadFile(filepath.Join(root, "generic.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	document["unexpected"] = true
	mutated, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "generic.json"), append(mutated, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyManifest(filepath.Join(root, "generic.json")); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown manifest field was accepted: %v", err)
	}
}

func TestResolveRelativeRejectsAbsoluteTraversalAndNonregular(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "dir"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "file"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("file", filepath.Join(root, "link")); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}
	for _, test := range []struct {
		name string
		path string
	}{
		{name: "absolute", path: filepath.Join(root, "file")},
		{name: "parent", path: "../file"},
		{name: "dot", path: "./file"},
		{name: "backslash", path: "dir\\file"},
		{name: "symlink", path: "link"},
		{name: "directory as file", path: "dir"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := resolveRelative(root, test.path, false); err == nil {
				t.Fatalf("resolveRelative accepted %q", test.path)
			}
		})
	}
}

func TestReadRegularRootRejectsConcurrentExternalAncestorSwap(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("directory replacement while a handle is open is not portable to Windows")
	}
	rootPath := t.TempDir()
	outside := t.TempDir()
	ancestor := filepath.Join(rootPath, "ancestor")
	held := filepath.Join(rootPath, "held")
	if err := os.Mkdir(ancestor, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ancestor, "value"), []byte("inside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "value"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := filepath.Join(rootPath, "symlink-probe")
	if err := os.Symlink(outside, probe); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}
	if err := os.Remove(probe); err != nil {
		t.Fatal(err)
	}

	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if raw, err := readRegularRoot(root, "ancestor/value"); err != nil || string(raw) != "inside" {
		t.Fatalf("initial rooted read = %q, %v", raw, err)
	}

	writerErrors := make(chan error, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 500 {
			if err := os.Rename(ancestor, held); err != nil {
				writerErrors <- err
				return
			}
			if err := os.Symlink(outside, ancestor); err != nil {
				_ = os.Rename(held, ancestor)
				writerErrors <- err
				return
			}
			runtime.Gosched()
			if err := os.Remove(ancestor); err != nil {
				writerErrors <- err
				return
			}
			if err := os.Rename(held, ancestor); err != nil {
				writerErrors <- err
				return
			}
		}
	}()

	for {
		select {
		case <-done:
			select {
			case err := <-writerErrors:
				t.Fatalf("ancestor swap failed: %v", err)
			default:
			}
			raw, err := readRegularRoot(root, "ancestor/value")
			if err != nil || string(raw) != "inside" {
				t.Fatalf("final rooted read = %q, %v", raw, err)
			}
			return
		default:
			raw, err := readRegularRoot(root, "ancestor/value")
			if err == nil && string(raw) != "inside" {
				t.Fatalf("rooted read escaped corpus: %q", raw)
			}
		}
	}
}

func copiedCorpus(t *testing.T) (string, Manifest) {
	t.Helper()
	source := filepath.Join("..", "conformance", "takoform-v1")
	destination := t.TempDir()
	if err := copyTree(source, destination); err != nil {
		t.Fatal(err)
	}
	manifest, _, err := LoadManifest(filepath.Join(destination, "generic.json"))
	if err != nil {
		t.Fatal(err)
	}
	return destination, manifest
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("source corpus unexpectedly contains a symlink")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, raw, 0o600)
	})
}

func writeManifest(t *testing.T, path string, manifest Manifest) {
	t.Helper()
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
}
