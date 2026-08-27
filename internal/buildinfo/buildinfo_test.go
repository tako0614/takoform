package buildinfo

import (
	"encoding/json"
	"runtime/debug"
	"testing"
)

func TestResolveUsesVanillaModuleVersionAndSumWithoutInventingCommit(t *testing.T) {
	got := resolve("form-package", &debug.BuildInfo{
		Main: debug.Module{
			Path:    Module,
			Version: "v1.0.0",
			Sum:     "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		},
	}, true, "devel", "unknown")

	want := Info{
		Command: "form-package",
		Module:  Module,
		Version: "v1.0.0",
		Sum:     "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	}
	if got != want {
		t.Fatalf("resolve() = %#v, want %#v", got, want)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"command":"form-package","module":"github.com/tako0614/takoform","version":"v1.0.0","sum":"h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}` {
		t.Fatalf("JSON = %s", raw)
	}
}

func TestResolveReportsCommitOnlyWhenActuallyEmbedded(t *testing.T) {
	commit := "0123456789abcdef0123456789abcdef01234567"
	got := resolve("takoform-trust", &debug.BuildInfo{
		Main: debug.Module{Path: Module, Version: "(devel)"},
		Settings: []debug.BuildSetting{
			{Key: "vcs.revision", Value: commit},
		},
	}, true, "devel", "")
	if got.Version != "devel" || got.Commit != commit || got.Sum != "" {
		t.Fatalf("resolve() = %#v", got)
	}

	without := resolve("takoform-trust", nil, false, "devel", "unknown")
	if without.Commit != "" {
		t.Fatalf("unembedded commit was reported: %#v", without)
	}
}
