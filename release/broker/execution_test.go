package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestCredentialEnvelopeRejectsExtraMissingAndOffPhaseKeys(t *testing.T) {
	expected := []string{"GH_TOKEN"}
	valid := []byte(`{"GH_TOKEN":"secret"}` + "\n")
	values, err := validateCredentialEnvelope(valid, expected)
	if err != nil {
		t.Fatalf("exact credential envelope was rejected: %v", err)
	}
	zeroCredentialValues(values)
	for name, raw := range map[string][]byte{
		"extra":        []byte(`{"GH_TOKEN":"secret","OTHER":"value"}` + "\n"),
		"missing":      []byte(`{}` + "\n"),
		"off phase":    []byte(`{"CLOUDFLARE_API_TOKEN":"secret"}` + "\n"),
		"empty":        []byte(`{"GH_TOKEN":""}` + "\n"),
		"noncanonical": []byte(`{ "GH_TOKEN":"secret"}` + "\n"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateCredentialEnvelope(raw, expected); err == nil {
				t.Fatal("invalid credential envelope was accepted")
			}
		})
	}
}

func TestCredentialFDRequiresRootMode0600OneLinkReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credential.json")
	if err := os.WriteFile(path, []byte(`{"GH_TOKEN":"secret"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateCredentialFDMetadata(int(file.Fd())); err != nil {
		t.Fatalf("exact protected credential FD was rejected: %v", err)
	}
	descriptorFlags, err := unix.FcntlInt(file.Fd(), unix.F_GETFD, 0)
	if err != nil || descriptorFlags&unix.FD_CLOEXEC == 0 {
		t.Fatalf("credential FD was not sealed close-on-exec: flags=%#x err=%v", descriptorFlags, err)
	}
	file.Close()

	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}
	file, _ = os.Open(path)
	if _, err := validateCredentialFDMetadata(int(file.Fd())); err == nil {
		t.Fatal("group-readable credential FD was accepted")
	}
	file.Close()
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(path, path+".second-link"); err != nil {
		t.Fatal(err)
	}
	file, _ = os.Open(path)
	if _, err := validateCredentialFDMetadata(int(file.Fd())); err == nil {
		t.Fatal("multiply-linked credential FD was accepted")
	}
	file.Close()
}

func TestProtectedChildFDIsUnlinkedRootOwnedAndExactMode(t *testing.T) {
	stateRoot := t.TempDir()
	if err := os.Chmod(stateRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	state, _, err := openExactDirectory(stateRoot, "state", 0, 0, 0o700)
	if err != nil {
		t.Fatal(err)
	}
	defer state.Close()
	for _, mode := range []uint32{0o400, 0o600} {
		file, err := createUnlinkedProtectedFile(int(state.Fd()), "fixture", []byte("fixture\n"), mode)
		if err != nil {
			t.Fatal(err)
		}
		var stat unix.Stat_t
		if err := unix.Fstat(int(file.Fd()), &stat); err != nil {
			t.Fatal(err)
		}
		if stat.Uid != 0 || stat.Gid != 0 || uint32(stat.Mode&0o777) != mode || stat.Nlink != 0 {
			t.Fatalf("protected FD identity differs: uid=%d gid=%d mode=%o nlink=%d", stat.Uid, stat.Gid, stat.Mode&0o777, stat.Nlink)
		}
		file.Close()
	}
	entries, err := os.ReadDir(stateRoot)
	if err != nil || len(entries) != 0 {
		t.Fatalf("protected FD left a named file: %v %#v", err, entries)
	}
}

func TestCapabilityConsumeMarkerRefusesReplay(t *testing.T) {
	stateRoot := t.TempDir()
	if err := os.Chmod(stateRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	state, _, err := openExactDirectory(stateRoot, "state", 0, 0, 0o700)
	if err != nil {
		t.Fatal(err)
	}
	defer state.Close()
	validated := &validatedProposal{proposalSHA256: "sha256:" + strings.Repeat("a", 64), reviewSHA256: "sha256:" + strings.Repeat("b", 64), brokerIdentitySHA: "sha256:" + strings.Repeat("c", 64)}
	validated.proposal.Nonce = strings.Repeat("d", 64)
	validated.proposal.Invocation.SHA256 = "sha256:" + strings.Repeat("e", 64)
	execution := &executionCopy{mappingSHA256: "sha256:" + strings.Repeat("f", 64)}
	execution.invocation.SHA256 = "sha256:" + strings.Repeat("1", 64)
	capabilitySHA256 := "sha256:" + strings.Repeat("2", 64)
	raw, digest, err := persistConsumeMarker(int(state.Fd()), validated, execution, capabilitySHA256)
	if err != nil {
		t.Fatalf("first atomic consume failed: %v", err)
	}
	if digest != digestBytes(raw) {
		t.Fatalf("marker digest does not bind exact persisted bytes: got %s", digest)
	}
	var marker consumeMarker
	if _, err := parseCanonicalJSON(raw, maximumProposalBytes, "consume marker", &marker); err != nil {
		t.Fatal(err)
	}
	if marker.CapabilityEnvelopeSHA256 != capabilitySHA256 {
		t.Fatalf("marker did not bind minted capability: got %s", marker.CapabilityEnvelopeSHA256)
	}
	if _, _, err := persistConsumeMarker(int(state.Fd()), validated, execution, capabilitySHA256); err == nil {
		t.Fatal("replayed nonce was accepted")
	}
}

func TestCapabilityDigestUsesCanonicalNonSelfReferentialPreimage(t *testing.T) {
	validated := &validatedProposal{
		proposalSHA256:    "sha256:" + strings.Repeat("a", 64),
		reviewSHA256:      "sha256:" + strings.Repeat("b", 64),
		brokerIdentitySHA: "sha256:" + strings.Repeat("c", 64),
	}
	validated.proposal.Nonce = strings.Repeat("d", 64)
	validated.proposal.Invocation.SHA256 = "sha256:" + strings.Repeat("e", 64)
	validated.proposal.Credential.Class = credentialClass
	validated.proposal.Credential.Names = []string{"GH_TOKEN"}
	execution := &executionCopy{
		sourceRoot:    "/private/source",
		ephemeralRoot: "/private/ephemeral",
		mappingSHA256: "sha256:" + strings.Repeat("f", 64),
		invocation: invocation{
			Surface: "release", Phase: "publish", Args: []string{"--continuation-phase", "publish"},
			SHA256: "sha256:" + strings.Repeat("1", 64),
		},
	}
	capability, raw, digest, err := mintInternalCapability(validated, execution)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroBytes(raw)
	if digest != digestBytes(raw) || len(raw) == 0 || raw[len(raw)-1] != '\n' {
		t.Fatalf("capability digest is not canonical JSON+LF preimage: %s", digest)
	}
	if strings.Contains(string(raw), "capability-envelope-sha256") || strings.Contains(string(raw), "capability-consume-marker-sha256") {
		t.Fatal("capability preimage contains a self or future consume-marker digest")
	}
	if _, exists := capability.AuthenticityEvidence["capability-envelope-sha256"]; exists {
		t.Fatal("capability object gained a self-referential digest")
	}
	if capability.EphemeralRoot != execution.ephemeralRoot {
		t.Fatal("capability did not bind the broker-owned ephemeral root")
	}
}

func TestEphemeralCleanupReportsSuccessAndFailure(t *testing.T) {
	root := filepath.Join(t.TempDir(), "ephemeral")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := cleanupEphemeralRoot(config{removeAll: os.RemoveAll}, root); err != nil {
		t.Fatalf("successful cleanup was reported as failure: %v", err)
	}
	root = filepath.Join(t.TempDir(), "ephemeral")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	want := errors.New("injected cleanup failure")
	err := cleanupEphemeralRoot(config{removeAll: func(string) error { return want }}, root)
	if !errors.Is(err, want) {
		t.Fatalf("cleanup failure was hidden: %v", err)
	}
}

func TestFinalNodeSpawnReceivesOnlyUnlinkedProtectedFDsAndRedactsSuccessAndFailure(t *testing.T) {
	for _, fixture := range []struct {
		name       string
		runnerBody string
		wantStatus string
	}{
		{name: "success", runnerBody: "fake-runner-success\n"},
		{name: "failure", runnerBody: "fake-runner-failure\n", wantStatus: "exit status 23"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			stateRoot := t.TempDir()
			if err := os.Chmod(stateRoot, 0o700); err != nil {
				t.Fatal(err)
			}
			state, _, err := openExactDirectory(stateRoot, "state", 0, 0, 0o700)
			if err != nil {
				t.Fatal(err)
			}
			defer state.Close()
			executionRoot := filepath.Join(stateRoot, "execution-fixture")
			sourceRoot := filepath.Join(executionRoot, "source")
			runnerPath := filepath.Join(sourceRoot, "scripts", "sealed-deploy-runner.mjs")
			ephemeralRoot := filepath.Join(executionRoot, "ephemeral")
			if err := os.MkdirAll(filepath.Dir(runnerPath), 0o700); err != nil || os.Mkdir(ephemeralRoot, 0o700) != nil ||
				os.WriteFile(runnerPath, []byte(fixture.runnerBody), 0o444) != nil || os.Chmod(filepath.Dir(runnerPath), 0o555) != nil ||
				os.Chmod(sourceRoot, 0o555) != nil || os.Chmod(ephemeralRoot, 0o700) != nil {
				t.Fatal("create fake sealed runner fixture")
			}
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			execution := &executionCopy{
				root: executionRoot, sourceRoot: sourceRoot, runnerPath: runnerPath, ephemeralRoot: ephemeralRoot,
				invocation: invocation{Surface: "takoform-core-release", Phase: "publish", Args: []string{"takoform-core-release", "publish"}, SHA256: "sha256:" + strings.Repeat("a", 64)},
			}
			request := runRequest{
				Format: runRequestFormat, ProposalEnvelopeSHA256: "sha256:" + strings.Repeat("b", 64), ReviewRecordSHA256: "sha256:" + strings.Repeat("c", 64),
				Source: runSource{Commit: strings.Repeat("d", 40), Root: sourceRoot}, Invocation: execution.invocation,
				Credential: runCredential{Class: credentialClass, Names: []string{"GH_TOKEN"}}, EphemeralRoot: ephemeralRoot,
			}
			runRaw, err := canonicalJSONLine(request)
			if err != nil {
				t.Fatal(err)
			}
			credentialRaw := []byte(`{"GH_TOKEN":"top-secret-value"}` + "\n")
			runFD, err := createUnlinkedProtectedFile(int(state.Fd()), "run", runRaw, 0o400)
			if err != nil {
				t.Fatal(err)
			}
			defer runFD.Close()
			credentialFD, err := createUnlinkedProtectedFile(int(state.Fd()), "credential", credentialRaw, 0o600)
			if err != nil {
				t.Fatal(err)
			}
			defer credentialFD.Close()
			stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
			cfg := config{nodePath: executable, stdout: stdout, stderr: stderr}
			credentials := map[string][]byte{"GH_TOKEN": []byte("top-secret-value")}
			err = spawnSealedRunner(cfg, execution, runFD, credentialFD, credentials)
			if fixture.wantStatus == "" && err != nil {
				t.Fatalf("sealed fake runner failed: %v", err)
			}
			if fixture.wantStatus != "" && (err == nil || !strings.Contains(err.Error(), fixture.wantStatus)) {
				t.Fatalf("sealed fake runner failure status was lost: %v", err)
			}
			combined := append(bytes.Clone(stdout.Bytes()), stderr.Bytes()...)
			if bytes.Contains(combined, []byte("top-secret-value")) || !bytes.Contains(combined, []byte("[REDACTED]")) {
				t.Fatalf("credential output redaction failed: %q", combined)
			}
			if _, err := os.Stat(filepath.Join(ephemeralRoot, "runner-created")); err != nil {
				t.Fatalf("fake runner did not reach protected execution: %v", err)
			}
			if err := cleanupEphemeralRoot(config{removeAll: os.RemoveAll}, executionRoot); err != nil {
				t.Fatalf("post-run cleanup failed: %v", err)
			}
		})
	}
}
