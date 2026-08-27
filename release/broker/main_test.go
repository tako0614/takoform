package main

import (
	"bytes"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestParseCLIRequiresTheExactClosedInterface(t *testing.T) {
	valid := []string{
		"--proposal", "/private/proposal.json",
		"--proposal-sha256", "sha256:" + strings.Repeat("a", 64),
		"--review", "/private/review.json",
		"--signature", "/private/review.sig",
	}
	if _, err := parseCLI(valid); err != nil {
		t.Fatalf("valid exact CLI was rejected: %v", err)
	}
	for name, args := range map[string][]string{
		"missing":     valid[:6],
		"extra":       append(append([]string{}, valid...), "--runner", "/tmp/x"),
		"relative":    append([]string{"--proposal", "proposal.json"}, valid[2:]...),
		"open digest": append(append([]string{}, valid[:3]...), "SHA256:"+strings.Repeat("a", 64), valid[4], valid[5], valid[6], valid[7]),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseCLI(args); err == nil {
				t.Fatal("open or malformed CLI was accepted")
			}
		})
	}
}

func TestAmbientEnvironmentIsRejectedBeforeExecution(t *testing.T) {
	if err := rejectAmbientEnvironment(nil); err != nil {
		t.Fatalf("empty environment was rejected: %v", err)
	}
	for _, environment := range [][]string{{"PATH=/usr/bin"}, {"LD_PRELOAD=/tmp/evil.so"}, {"DYLD_INSERT_LIBRARIES=/tmp/evil.dylib"}} {
		if err := rejectAmbientEnvironment(environment); err == nil {
			t.Fatalf("ambient environment was accepted: %q", environment)
		}
	}
}

func TestRejectedAmbientAuthorityNeverReachesRunnerEntrypoint(t *testing.T) {
	canary := filepath.Join(t.TempDir(), "runner-reached")
	runner := filepath.Join(t.TempDir(), "node-canary")
	if err := os.WriteFile(runner, []byte("#!/bin/sh\n: > '"+canary+"'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	args := []string{
		"--proposal", "/private/proposal.json",
		"--proposal-sha256", "sha256:" + strings.Repeat("a", 64),
		"--review", "/private/review.json",
		"--signature", "/private/review.sig",
	}
	if err := run(config{nodePath: runner, credentialFD: -1}, args, []string{"LD_PRELOAD=/tmp/evil.so"}); err == nil {
		t.Fatal("ambient loader authority was accepted")
	}
	if _, err := os.Lstat(canary); !os.IsNotExist(err) {
		t.Fatalf("sealed runner was reached on rejection: %v", err)
	}
}

func TestRunSealsCredentialFDBeforeProposalOrParserValidation(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credential.json")
	if err := os.WriteFile(credentialPath, []byte(`{"GH_TOKEN":"secret"}`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	credential, err := os.Open(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	defer credential.Close()
	if _, err := unix.FcntlInt(credential.Fd(), unix.F_SETFD, 0); err != nil {
		t.Fatalf("clear fixture CLOEXEC: %v", err)
	}
	args := []string{
		"--proposal", "/does-not-exist/proposal.json",
		"--proposal-sha256", "sha256:" + strings.Repeat("a", 64),
		"--review", "/does-not-exist/review.json",
		"--signature", "/does-not-exist/review.sig",
	}
	err = run(config{credentialFD: int(credential.Fd())}, args, nil)
	if err == nil || !strings.Contains(err.Error(), "open sealed proposal") {
		t.Fatalf("proposal validation did not follow credential metadata sealing: %v", err)
	}
	descriptorFlags, err := unix.FcntlInt(credential.Fd(), unix.F_GETFD, 0)
	if err != nil || descriptorFlags&unix.FD_CLOEXEC == 0 {
		t.Fatalf("credential FD could leak to a parser child: flags=%#x err=%v", descriptorFlags, err)
	}
}

func TestPreCredentialChildExecutionIsStaticallyRefused(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fileSet := token.NewFileSet()
	productionExecCalls := 0
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasSuffix(name, ".s") || strings.HasSuffix(name, ".S") {
			t.Fatalf("production assembly %s escapes the child-execution audit", name)
		}
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(raw, []byte("//go:linkname")) {
			t.Fatalf("production broker source %s uses go:linkname and escapes the child-execution audit", name)
		}
		parsed, err := parser.ParseFile(fileSet, name, raw, 0)
		if err != nil {
			t.Fatalf("parse production source %s: %v", name, err)
		}
		importPaths := map[string]string{}
		for _, imported := range parsed.Imports {
			importPath := strings.Trim(imported.Path.Value, `"`)
			alias := filepath.Base(importPath)
			if imported.Name != nil {
				if imported.Name.Name == "." || imported.Name.Name == "_" {
					t.Fatalf("production broker source %s has an unauditable dot/blank import", name)
				}
				alias = imported.Name.Name
			}
			importPaths[alias] = importPath
			if importPath == "os/exec" && name != "execution.go" {
				t.Fatalf("parser/validator source %s can spawn a pre-credential child", name)
			}
			if importPath == "unsafe" {
				t.Fatalf("production broker source %s imports unsafe and escapes the child-execution audit", name)
			}
		}
		for _, declaration := range parsed.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Body == nil {
				continue
			}
			calls := []string{}
			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				switch target := call.Fun.(type) {
				case *ast.Ident:
					calls = append(calls, target.Name)
				case *ast.SelectorExpr:
					packageName, _ := target.X.(*ast.Ident)
					packagePath := ""
					if packageName != nil {
						packagePath = importPaths[packageName.Name]
					}
					if packagePath == "os/exec" && (target.Sel.Name == "Command" || target.Sel.Name == "CommandContext") {
						productionExecCalls++
						if name != "execution.go" || function.Name.Name != "spawnSealedRunner" {
							t.Fatalf("production child spawn exists outside final sealed runner: %s:%s", name, function.Name.Name)
						}
					}
					if packageName != nil {
						forbidden := (packagePath == "os" && target.Sel.Name == "StartProcess") ||
							((packagePath == "syscall" || packagePath == "golang.org/x/sys/unix") &&
								strings.Contains(" Exec ForkExec Clone Fork Vfork RawSyscall Syscall Syscall6 ", " "+target.Sel.Name+" "))
						if forbidden {
							t.Fatalf("production broker has unaudited process/syscall surface %s.%s in %s:%s", packagePath, target.Sel.Name, name, function.Name.Name)
						}
					}
					if (target.Sel.Name == "Start" || target.Sel.Name == "Run") && function.Name.Name != "spawnSealedRunner" {
						t.Fatalf("production broker can start a child outside final sealed runner: %s:%s", name, function.Name.Name)
					}
				}
				return true
			})
			if function.Name.Name == "executeValidated" {
				positions := map[string]int{}
				for index, call := range calls {
					for _, required := range []string{"mintInternalCapability", "persistConsumeMarker", "readAllFDStable", "spawnSealedRunner"} {
						if call == required {
							positions[required] = index
						}
					}
				}
				if len(positions) != 4 {
					t.Fatalf("authority-order call is absent: %#v", positions)
				}
				if !(positions["mintInternalCapability"] < positions["persistConsumeMarker"] &&
					positions["persistConsumeMarker"] < positions["readAllFDStable"] &&
					positions["readAllFDStable"] < positions["spawnSealedRunner"]) {
					t.Fatalf("authority order drifted: %#v", positions)
				}
			}
		}
	}
	if productionExecCalls != 1 {
		t.Fatalf("production broker has %d child-spawn calls, want only final Node", productionExecCalls)
	}
}

func TestCanonicalJSONRejectsWhitespaceDuplicatesAndUnknownFields(t *testing.T) {
	type closed struct {
		A string `json:"a"`
	}
	for name, raw := range map[string]string{
		"whitespace": `{ "a":"x"}` + "\n",
		"duplicate":  `{"a":"x","a":"y"}` + "\n",
		"unknown":    `{"a":"x","b":1}` + "\n",
		"missing LF": `{"a":"x"}`,
		"extra LF":   `{"a":"x"}` + "\n\n",
	} {
		t.Run(name, func(t *testing.T) {
			var value closed
			if _, err := parseCanonicalJSON([]byte(raw), 1024, "fixture", &value); err == nil {
				t.Fatal("noncanonical or open JSON was accepted")
			}
		})
	}
	var value closed
	canonical, err := parseCanonicalJSON([]byte(`{"a":"x"}`+"\n"), 1024, "fixture", &value)
	if err != nil {
		t.Fatalf("canonical closed JSON was rejected: %v", err)
	}
	if value.A != "x" || !bytes.Equal(canonical, []byte(`{"a":"x"}`)) {
		t.Fatalf("canonical parse changed data: %#v %q", value, canonical)
	}
}
