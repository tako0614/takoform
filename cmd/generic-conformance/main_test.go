package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/tako0614/takoform/genericconformance"
)

func TestVersionCommandEmitsStableJSON(t *testing.T) {
	var stdout bytes.Buffer
	if err := run([]string{"version"}, &stdout); err != nil {
		t.Fatal(err)
	}
	want := "{\"command\":\"generic-conformance\",\"module\":\"github.com/tako0614/takoform\",\"version\":\"devel\"}\n"
	if stdout.String() != want {
		t.Fatalf("version output = %q, want %q", stdout.String(), want)
	}
}

func TestVersionCommandRejectsUnknownArguments(t *testing.T) {
	if err := run([]string{"version", "unexpected"}, &bytes.Buffer{}); err == nil {
		t.Fatal("version accepted an unknown argument")
	}
}

func TestVerifyCommandEmitsStablePassedReport(t *testing.T) {
	var stdout bytes.Buffer
	err := run([]string{
		"verify",
		"--manifest", filepath.Join("..", "..", "conformance", "takoform-v1", "generic.json"),
	}, &stdout)
	if err != nil {
		t.Fatal(err)
	}
	var report genericconformance.Report
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("decode report: %v\n%s", err, stdout.String())
	}
	if report.Format != genericconformance.ReportFormat || report.Status != "passed" {
		t.Fatalf("report identity = %#v", report)
	}
	if len(report.Snapshots) != 2 || len(report.Checks) == 0 || len(report.Errors) != 0 {
		t.Fatalf("report contents = %#v", report)
	}
}

func TestVerifyCommandEmitsFailureReportAndReturnsError(t *testing.T) {
	var stdout bytes.Buffer
	err := run([]string{"verify", "--manifest", filepath.Join(t.TempDir(), "missing.json")}, &stdout)
	if err == nil {
		t.Fatal("verify accepted a missing manifest")
	}
	var report genericconformance.Report
	if decodeErr := json.Unmarshal(stdout.Bytes(), &report); decodeErr != nil {
		t.Fatalf("decode failure report: %v\n%s", decodeErr, stdout.String())
	}
	if report.Format != genericconformance.ReportFormat || report.Status != "failed" || len(report.Errors) != 1 {
		t.Fatalf("failure report = %#v", report)
	}
}
