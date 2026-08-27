package main

import (
	"bytes"
	"testing"
)

func TestVersionCommandEmitsStableJSON(t *testing.T) {
	var output bytes.Buffer
	if err := run([]string{"version"}, &output); err != nil {
		t.Fatal(err)
	}
	want := "{\"command\":\"form-package\",\"module\":\"github.com/tako0614/takoform\",\"version\":\"devel\"}\n"
	if output.String() != want {
		t.Fatalf("version output = %q, want %q", output.String(), want)
	}
}

func TestVersionCommandRejectsUnknownArguments(t *testing.T) {
	if err := run([]string{"version", "unexpected"}, &bytes.Buffer{}); err == nil {
		t.Fatal("version accepted an unknown argument")
	}
}
