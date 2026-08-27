package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestMain(suite *testing.M) {
	if len(os.Args) == 6 && os.Args[2] == "--broker-run-request-fd" && os.Args[3] == "3" &&
		os.Args[4] == "--broker-credential-fd" && os.Args[5] == "4" {
		os.Exit(fakeNodeRunner())
	}
	os.Exit(suite.Run())
}

func fakeNodeRunner() int {
	if len(os.Environ()) != 0 {
		_, _ = fmt.Fprintln(os.Stderr, "fake Node inherited ambient environment")
		return 90
	}
	runRaw, _, err := readAllFDStable(3, "child run request", maximumProposalBytes, 0, 0, 0o400, 0)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "fake Node rejected FD3: %v\n", err)
		return 91
	}
	credentialRaw, _, err := readAllFDStable(4, "child credential", maximumCredentialBytes, 0, 0, 0o600, 0)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "fake Node rejected FD4: %v\n", err)
		return 92
	}
	var request runRequest
	if _, err := parseCanonicalJSON(runRaw, maximumProposalBytes, "child run request", &request); err != nil || request.Format != runRequestFormat {
		_, _ = fmt.Fprintf(os.Stderr, "fake Node rejected run request: %v\n", err)
		return 93
	}
	var credentials map[string]string
	if _, err := parseCanonicalJSON(credentialRaw, maximumCredentialBytes, "child credential", &credentials); err != nil || len(credentials) != 1 {
		_, _ = fmt.Fprintf(os.Stderr, "fake Node rejected credential: %v\n", err)
		return 94
	}
	workingDirectory, err := os.Getwd()
	if err != nil || workingDirectory != request.Source.Root || request.Invocation.Args[0] != request.Invocation.Surface || request.Invocation.Args[1] != request.Invocation.Phase {
		_, _ = fmt.Fprintln(os.Stderr, "fake Node received an unbound cwd or invocation")
		return 95
	}
	var rootStat unix.Stat_t
	if err := unix.Stat(request.Source.Root, &rootStat); err != nil || rootStat.Uid != 0 || rootStat.Gid != 0 || uint32(rootStat.Mode&0o777) != 0o555 {
		_, _ = fmt.Fprintln(os.Stderr, "fake Node source is not broker-resealed root:root 0555")
		return 96
	}
	secret := credentials[request.Credential.Names[0]]
	if secret == "" {
		_, _ = fmt.Fprintln(os.Stderr, "fake Node credential binding is empty")
		return 97
	}
	if err := os.WriteFile(filepath.Join(request.EphemeralRoot, "runner-created"), []byte("temporary\n"), 0o600); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "fake Node cannot use ephemeral root: %v\n", err)
		return 98
	}
	_, _ = fmt.Fprintf(os.Stdout, "runner stdout secret=%s\n", secret)
	_, _ = fmt.Fprintf(os.Stderr, "runner stderr secret=%s\n", secret)
	runnerRaw, err := os.ReadFile(os.Args[1])
	if err != nil {
		return 99
	}
	if string(runnerRaw) == "fake-runner-failure\n" {
		return 23
	}
	if string(runnerRaw) != "fake-runner-success\n" {
		return 100
	}
	return 0
}
