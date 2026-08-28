package formpackage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const stableRevocationGenesisJSON = `{"apiVersion":"trust.forms.takoform.com/v1","checkpointVersion":"0.0.0","entries":[],"kind":"FormPackageRevocationCheckpoint","previousCheckpointDigest":null,"sequence":0}`

func TestValidateRevocationStatement(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	raw := []byte(fmt.Sprintf(`{
  "apiVersion":"trust.forms.takoform.com/v1alpha1",
  "kind":"FormPackageRevocation",
  "sequence":1,
  "statementVersion":"1.0.0",
  "packageDigest":%q,
  "formRef":{"apiVersion":"forms.takoform.com/v1alpha1","kind":"ObjectBucket","definitionVersion":"1.0.0","schemaDigest":%q},
  "reasonCode":"signature-invalid",
  "summary":"The retained signature cannot be validated.",
  "advisoryUrl":"https://example.com/advisories/TF-1",
  "issuedAt":"2026-07-17T00:00:00Z",
  "effects":{"blockNewCreateOrUpdate":true,"blockActivation":true,"retainBytesForObserveAndDelete":true}
}`, digest, digest))
	statement, err := ValidateRevocationStatement(raw)
	if err != nil {
		t.Fatal(err)
	}
	if statement.PackageDigest != digest || statement.StatementVersion != "1.0.0" {
		t.Fatalf("unexpected statement: %+v", statement)
	}
}

func TestValidateCurrentRevocationStatementUsesStableFormRef(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	raw := []byte(fmt.Sprintf(`{
  "apiVersion":"trust.forms.takoform.com/v1",
  "kind":"FormPackageRevocation",
  "sequence":1,
  "statementVersion":"1.0.0",
  "packageDigest":%q,
  "formRef":{"apiVersion":"storage.forms.publisher.example","kind":"ObjectBucket","definitionVersion":"0.1.0","schemaDigest":%q},
  "reasonCode":"signature-invalid",
  "summary":"The retained signature cannot be validated.",
  "issuedAt":"2026-08-28T00:00:00Z",
  "effects":{"blockNewCreateOrUpdate":true,"blockActivation":true,"retainBytesForObserveAndDelete":true}
}`, digest, digest))
	statement, err := ValidateRevocationStatement(raw)
	if err != nil {
		t.Fatal(err)
	}
	if statement.APIVersion != CurrentTrustAPIVersion || statement.FormRef.APIVersion != "storage.forms.publisher.example" {
		t.Fatalf("unexpected current revocation statement: %+v", statement)
	}

	legacyRef := strings.Replace(string(raw), "storage.forms.publisher.example", LegacyFormAPIVersion, 1)
	if _, err := ValidateRevocationStatement([]byte(legacyRef)); err == nil {
		t.Fatal("current revocation statement accepted a legacy FormRef")
	}
	reservedRef := strings.Replace(string(raw), "storage.forms.publisher.example", "trust.forms.takoform.com", 1)
	if _, err := ValidateRevocationStatement([]byte(reservedRef)); err == nil {
		t.Fatal("current revocation statement accepted a reserved envelope namespace as a FormRef")
	}
	reservedVersion := strings.Replace(string(raw), `"statementVersion":"1.0.0"`, `"statementVersion":"0.0.0"`, 1)
	if _, err := ValidateRevocationStatement([]byte(reservedVersion)); err == nil {
		t.Fatal("current revocation statement accepted the genesis-only checkpoint version")
	}
}

func TestRevocationCheckpointEntryForCurrentStatementClosesIdentity(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	raw := []byte(fmt.Sprintf(`{"apiVersion":"trust.forms.takoform.com/v1","effects":{"blockActivation":true,"blockNewCreateOrUpdate":true,"retainBytesForObserveAndDelete":true},"formRef":{"apiVersion":"storage.forms.publisher.example","definitionVersion":"0.1.0","kind":"ObjectBucket","schemaDigest":%q},"issuedAt":"2026-08-28T00:00:00Z","kind":"FormPackageRevocation","packageDigest":%q,"reasonCode":"signature-invalid","sequence":1,"statementVersion":"1.0.0","summary":"invalid"}`, digest, digest))
	entry, err := RevocationCheckpointEntryForStatement(raw)
	if err != nil {
		t.Fatal(err)
	}
	wantDigest, err := DigestCanonicalJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if entry.StatementAPIVersion != CurrentTrustAPIVersion || entry.Sequence != 1 ||
		entry.StatementVersion != "1.0.0" || entry.StatementDigest != wantDigest ||
		entry.PackageDigest != digest || entry.FormRef.APIVersion != "storage.forms.publisher.example" {
		t.Fatalf("unexpected derived checkpoint entry: %+v", entry)
	}
}

func TestRevocationCheckpointEntryRejectsNonCanonicalStatementBytes(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	pretty := []byte(fmt.Sprintf(`{
  "apiVersion": "trust.forms.takoform.com/v1",
  "kind": "FormPackageRevocation",
  "sequence": 1,
  "statementVersion": "1.0.0",
  "packageDigest": %q,
  "formRef": {
    "apiVersion": "storage.forms.publisher.example",
    "kind": "ObjectBucket",
    "definitionVersion": "0.1.0",
    "schemaDigest": %q
  },
  "reasonCode": "signature-invalid",
  "summary": "invalid",
  "issuedAt": "2026-08-28T00:00:00Z",
  "effects": {
    "blockNewCreateOrUpdate": true,
    "blockActivation": true,
    "retainBytesForObserveAndDelete": true
  }
}`, digest, digest))
	if _, err := RevocationCheckpointEntryForStatement(pretty); err == nil || !strings.Contains(err.Error(), "canonical") {
		t.Fatalf("noncanonical signed statement bytes were accepted: %v", err)
	}
}

func TestValidateRevocationStatementRejectsUnsupportedProfile(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	raw := fmt.Sprintf(`{"apiVersion":"trust.forms.takoform.com/v2","kind":"FormPackageRevocation","sequence":1,"statementVersion":"1.0.0","packageDigest":%q,"formRef":{"apiVersion":"storage.forms.publisher.example","kind":"ObjectBucket","definitionVersion":"0.1.0","schemaDigest":%q},"reasonCode":"signature-invalid","summary":"invalid","issuedAt":"2026-08-28T00:00:00Z","effects":{"blockNewCreateOrUpdate":true,"blockActivation":true,"retainBytesForObserveAndDelete":true}}`, digest, digest)
	if _, err := ValidateRevocationStatement([]byte(raw)); err == nil {
		t.Fatal("unsupported revocation statement profile unexpectedly accepted")
	}
}

func TestValidateRevocationCheckpointAcceptsStableSignedGenesisShape(t *testing.T) {
	t.Parallel()
	checkpoint, err := ValidateRevocationCheckpoint([]byte(stableRevocationGenesisJSON))
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint.APIVersion != "trust.forms.takoform.com/v1" ||
		checkpoint.CheckpointVersion != "0.0.0" || checkpoint.Sequence != 0 ||
		checkpoint.PreviousCheckpointDigest != nil || len(checkpoint.Entries) != 0 {
		t.Fatalf("unexpected signed genesis checkpoint: %+v", checkpoint)
	}
}

func TestCurrentRevocationConformanceFixturesCloseGenesisAndStatement(t *testing.T) {
	t.Parallel()
	fixture := filepath.Join("..", "conformance", "revocation-checkpoint-v1", "positive")
	read := func(name string) []byte {
		t.Helper()
		raw, err := os.ReadFile(filepath.Join(fixture, name))
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	genesis := read("checkpoint-genesis.json")
	statement := read("statement-1-current.json")
	first := read("checkpoint-1-from-genesis.json")
	canonicalStatement, err := Canonicalize(statement)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := RevocationCheckpointEntryForStatement(canonicalStatement)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, err := ValidateRevocationCheckpoint(first)
	if err != nil {
		t.Fatal(err)
	}
	if len(checkpoint.Entries) != 1 || checkpoint.Entries[0] != entry {
		t.Fatalf("current checkpoint entry does not identify its statement: checkpoint=%+v derived=%+v", checkpoint.Entries, entry)
	}
	genesisPin, err := AdvanceRevocationCheckpoint(nil, genesis)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AdvanceRevocationCheckpoint(&genesisPin, first); err != nil {
		t.Fatalf("current checkpoint fixture does not descend from genesis: %v", err)
	}
}

func TestRevocationCheckpointFixtureAdvancesPinnedHashChain(t *testing.T) {
	t.Parallel()
	fixture := filepath.Join("..", "conformance", "revocation-checkpoint-v1", "positive")
	first, err := os.ReadFile(filepath.Join(fixture, "checkpoint-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(filepath.Join(fixture, "checkpoint-2.json"))
	if err != nil {
		t.Fatal(err)
	}
	firstPin, err := AdvanceRevocationCheckpoint(nil, first)
	if err != nil {
		t.Fatal(err)
	}
	secondPin, err := AdvanceRevocationCheckpoint(&firstPin, second)
	if err != nil {
		t.Fatal(err)
	}
	if firstPin.CheckpointAPIVersion != "" || secondPin.CheckpointAPIVersion != "" ||
		firstPin.Sequence != 1 || secondPin.Sequence != 2 || firstPin.Digest == secondPin.Digest ||
		!ValidDigest(secondPin.EntriesDigest) {
		t.Fatalf("unexpected checkpoint pins: first=%+v second=%+v", firstPin, secondPin)
	}
	if _, err := AdvanceRevocationCheckpoint(&secondPin, first); err == nil {
		t.Fatal("rollback to an older checkpoint unexpectedly accepted")
	}
	wrongPrevious := strings.Replace(string(second), firstPin.Digest, "sha256:"+strings.Repeat("e", 64), 1)
	if _, err := AdvanceRevocationCheckpoint(&firstPin, []byte(wrongPrevious)); err == nil {
		t.Fatal("checkpoint fork unexpectedly accepted")
	}
	rewrittenPrefix := strings.Replace(string(second), "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sha256:"+strings.Repeat("f", 64), 1)
	if _, err := AdvanceRevocationCheckpoint(&firstPin, []byte(rewrittenPrefix)); err == nil {
		t.Fatal("checkpoint cumulative-prefix rewrite unexpectedly accepted")
	}
	omitted := strings.Replace(string(second), `"sequence": 1`, `"sequence": 9`, 1)
	if _, err := ValidateRevocationCheckpoint([]byte(omitted)); err == nil {
		t.Fatal("checkpoint omission/reordering unexpectedly accepted")
	}
}

func TestStableRevocationCheckpointAdvancesFromSignedGenesis(t *testing.T) {
	t.Parallel()
	genesisPin, err := AdvanceRevocationCheckpoint(nil, []byte(stableRevocationGenesisJSON))
	if err != nil {
		t.Fatalf("advance signed genesis: %v", err)
	}
	if genesisPin.CheckpointAPIVersion != CurrentTrustAPIVersion || genesisPin.Sequence != 0 ||
		!ValidDigest(genesisPin.Digest) || !ValidDigest(genesisPin.EntriesDigest) {
		t.Fatalf("unexpected genesis pin: %+v", genesisPin)
	}

	firstEntry := currentRevocationEntry(t, 1, "1.0.0", 'a', 'c')
	first := revocationCheckpointJSON(t, RevocationCheckpoint{
		APIVersion:               CurrentTrustAPIVersion,
		Kind:                     RevocationCheckpointKind,
		CheckpointVersion:        firstEntry.StatementVersion,
		Sequence:                 1,
		PreviousCheckpointDigest: &genesisPin.Digest,
		Entries:                  []RevocationCheckpointEntry{firstEntry},
	})
	firstPin, err := AdvanceRevocationCheckpoint(&genesisPin, first)
	if err != nil {
		t.Fatalf("advance first checkpoint from genesis: %v", err)
	}
	if firstPin.CheckpointAPIVersion != CurrentTrustAPIVersion || firstPin.Sequence != 1 ||
		firstPin.Digest == genesisPin.Digest || !ValidDigest(firstPin.EntriesDigest) {
		t.Fatalf("unexpected first stable pin: %+v", firstPin)
	}
	if _, err := AdvanceRevocationCheckpoint(nil, first); err == nil {
		t.Fatal("stable sequence-one checkpoint started without its signed genesis")
	}
	forgedGenesisPin := genesisPin
	forgedGenesisPin.Digest = "sha256:" + strings.Repeat("f", 64)
	firstFromForgedGenesis := revocationCheckpointJSON(t, RevocationCheckpoint{
		APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
		CheckpointVersion: firstEntry.StatementVersion, Sequence: 1,
		PreviousCheckpointDigest: &forgedGenesisPin.Digest,
		Entries:                  []RevocationCheckpointEntry{firstEntry},
	})
	if _, err := AdvanceRevocationCheckpoint(&forgedGenesisPin, firstFromForgedGenesis); err == nil || !strings.Contains(err.Error(), "exact signed current genesis") {
		t.Fatalf("stable sequence-one checkpoint advanced an invented sequence-zero pin: %v", err)
	}

	secondEntry := currentRevocationEntry(t, 2, "1.1.0", 'd', 'e')
	second := revocationCheckpointJSON(t, RevocationCheckpoint{
		APIVersion:               CurrentTrustAPIVersion,
		Kind:                     RevocationCheckpointKind,
		CheckpointVersion:        secondEntry.StatementVersion,
		Sequence:                 2,
		PreviousCheckpointDigest: &firstPin.Digest,
		Entries:                  []RevocationCheckpointEntry{firstEntry, secondEntry},
	})
	secondPin, err := AdvanceRevocationCheckpoint(&firstPin, second)
	if err != nil {
		t.Fatalf("advance second current checkpoint: %v", err)
	}
	if secondPin.CheckpointAPIVersion != CurrentTrustAPIVersion || secondPin.Sequence != 2 {
		t.Fatalf("unexpected second stable pin: %+v", secondPin)
	}
	if _, err := AdvanceRevocationCheckpoint(&secondPin, first); err == nil {
		t.Fatal("current checkpoint rollback unexpectedly accepted")
	}
	forkDigest := "sha256:" + strings.Repeat("f", 64)
	fork := revocationCheckpointJSON(t, RevocationCheckpoint{
		APIVersion:               CurrentTrustAPIVersion,
		Kind:                     RevocationCheckpointKind,
		CheckpointVersion:        secondEntry.StatementVersion,
		Sequence:                 2,
		PreviousCheckpointDigest: &forkDigest,
		Entries:                  []RevocationCheckpointEntry{firstEntry, secondEntry},
	})
	if _, err := AdvanceRevocationCheckpoint(&firstPin, fork); err == nil {
		t.Fatal("current checkpoint fork unexpectedly accepted")
	}
	rewrittenFirst := firstEntry
	rewrittenFirst.PackageDigest = "sha256:" + strings.Repeat("9", 64)
	rewrittenPrefix := revocationCheckpointJSON(t, RevocationCheckpoint{
		APIVersion:               CurrentTrustAPIVersion,
		Kind:                     RevocationCheckpointKind,
		CheckpointVersion:        secondEntry.StatementVersion,
		Sequence:                 2,
		PreviousCheckpointDigest: &firstPin.Digest,
		Entries:                  []RevocationCheckpointEntry{rewrittenFirst, secondEntry},
	})
	if _, err := AdvanceRevocationCheckpoint(&firstPin, rewrittenPrefix); err == nil {
		t.Fatal("current checkpoint cumulative-prefix rewrite unexpectedly accepted")
	}
}

func TestStableRevocationCheckpointRejectsMalformedGenesisAndEmptyStates(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	entry := currentRevocationEntry(t, 1, "1.0.0", 'b', 'c')
	tests := map[string]RevocationCheckpoint{
		"empty sequence one": {
			APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
			CheckpointVersion: "1.0.0", Sequence: 1, PreviousCheckpointDigest: &digest,
			Entries: []RevocationCheckpointEntry{},
		},
		"nonempty sequence zero": {
			APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
			CheckpointVersion: "0.0.0", Sequence: 0, Entries: []RevocationCheckpointEntry{entry},
		},
		"wrong genesis version": {
			APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
			CheckpointVersion: "1.0.0", Sequence: 0, Entries: []RevocationCheckpointEntry{},
		},
		"genesis predecessor digest": {
			APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
			CheckpointVersion: "0.0.0", Sequence: 0, PreviousCheckpointDigest: &digest,
			Entries: []RevocationCheckpointEntry{},
		},
		"sequence one null predecessor": {
			APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
			CheckpointVersion: "1.0.0", Sequence: 1, Entries: []RevocationCheckpointEntry{entry},
		},
		"non-genesis sentinel version": {
			APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
			CheckpointVersion: "0.0.0", Sequence: 1, PreviousCheckpointDigest: &digest,
			Entries: []RevocationCheckpointEntry{entry},
		},
	}
	for name, checkpoint := range tests {
		name, checkpoint := name, checkpoint
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := ValidateRevocationCheckpoint(revocationCheckpointJSON(t, checkpoint)); err == nil {
				t.Fatal("malformed current checkpoint unexpectedly accepted")
			}
		})
	}

	missingStatementProfile := entry
	missingStatementProfile.StatementAPIVersion = ""
	wrongStatementProfile := entry
	wrongStatementProfile.StatementAPIVersion = TrustAPIVersion
	legacyFormRef := entry
	legacyFormRef.FormRef.APIVersion = LegacyFormAPIVersion
	reservedFormRef := entry
	reservedFormRef.FormRef.APIVersion = "trust.forms.takoform.com"
	for name, invalidEntry := range map[string]RevocationCheckpointEntry{
		"missing statement profile": missingStatementProfile,
		"wrong statement profile":   wrongStatementProfile,
		"legacy FormRef":            legacyFormRef,
		"reserved FormRef":          reservedFormRef,
	} {
		name, invalidEntry := name, invalidEntry
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			checkpoint := RevocationCheckpoint{
				APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
				CheckpointVersion: invalidEntry.StatementVersion, Sequence: 1,
				PreviousCheckpointDigest: &digest, Entries: []RevocationCheckpointEntry{invalidEntry},
			}
			if _, err := ValidateRevocationCheckpoint(revocationCheckpointJSON(t, checkpoint)); err == nil {
				t.Fatal("current checkpoint entry crossed its statement/FormRef profile")
			}
		})
	}
}

func TestRevocationCheckpointPinsRejectCrossProfileAdvancement(t *testing.T) {
	t.Parallel()
	legacyFirst, err := os.ReadFile(filepath.Join("..", "conformance", "revocation-checkpoint-v1", "positive", "checkpoint-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	legacyPin, err := AdvanceRevocationCheckpoint(nil, legacyFirst)
	if err != nil {
		t.Fatal(err)
	}
	genesisPin, err := AdvanceRevocationCheckpoint(nil, []byte(stableRevocationGenesisJSON))
	if err != nil {
		t.Fatal(err)
	}
	entry := currentRevocationEntry(t, 1, "1.0.0", 'a', 'c')
	currentFirst := revocationCheckpointJSON(t, RevocationCheckpoint{
		APIVersion: CurrentTrustAPIVersion, Kind: RevocationCheckpointKind,
		CheckpointVersion: entry.StatementVersion, Sequence: 1,
		PreviousCheckpointDigest: &genesisPin.Digest, Entries: []RevocationCheckpointEntry{entry},
	})
	if _, err := AdvanceRevocationCheckpoint(&legacyPin, currentFirst); err == nil || !strings.Contains(err.Error(), "profile") {
		t.Fatalf("current checkpoint advanced a legacy pin: %v", err)
	}
	if _, err := AdvanceRevocationCheckpoint(&genesisPin, legacyFirst); err == nil || !strings.Contains(err.Error(), "profile") {
		t.Fatalf("legacy checkpoint advanced a current pin: %v", err)
	}
	unknownPin := genesisPin
	unknownPin.CheckpointAPIVersion = "trust.forms.takoform.com/v2"
	if _, err := AdvanceRevocationCheckpoint(&unknownPin, currentFirst); err == nil || !strings.Contains(err.Error(), "unsupported profile") {
		t.Fatalf("unknown pinned profile advanced: %v", err)
	}
}

func TestValidateRevocationStatementFailsClosed(t *testing.T) {
	t.Parallel()
	digest := "sha256:" + strings.Repeat("a", 64)
	base := fmt.Sprintf(`{"apiVersion":"trust.forms.takoform.com/v1alpha1","kind":"FormPackageRevocation","sequence":1,"statementVersion":"1.0.0","packageDigest":%q,"formRef":{"apiVersion":"forms.takoform.com/v1alpha1","kind":"ObjectBucket","definitionVersion":"1.0.0","schemaDigest":%q},"reasonCode":"signature-invalid","summary":"invalid","issuedAt":"2026-07-17T00:00:00Z","effects":{"blockNewCreateOrUpdate":true,"blockActivation":true,"retainBytesForObserveAndDelete":true}}`, digest, digest)
	for _, mutation := range []struct {
		name string
		from string
		to   string
	}{
		{name: "allows update", from: `"blockNewCreateOrUpdate":true`, to: `"blockNewCreateOrUpdate":false`},
		{name: "allows activation", from: `"blockActivation":true`, to: `"blockActivation":false`},
		{name: "drops retained bytes", from: `"retainBytesForObserveAndDelete":true`, to: `"retainBytesForObserveAndDelete":false`},
		{name: "deprecation is not revocation", from: `"signature-invalid"`, to: `"deprecated"`},
		{name: "non-https advisory", from: `"issuedAt"`, to: `"advisoryUrl":"http://example.com/a","issuedAt"`},
	} {
		mutation := mutation
		t.Run(mutation.name, func(t *testing.T) {
			t.Parallel()
			_, err := ValidateRevocationStatement([]byte(strings.Replace(base, mutation.from, mutation.to, 1)))
			if err == nil {
				t.Fatal("invalid revocation unexpectedly accepted")
			}
		})
	}
}

func currentRevocationEntry(t *testing.T, sequence uint64, statementVersion string, packageDigit, schemaDigit byte) RevocationCheckpointEntry {
	t.Helper()
	statement := RevocationStatement{
		APIVersion:       CurrentTrustAPIVersion,
		Kind:             RevocationKind,
		Sequence:         sequence,
		StatementVersion: statementVersion,
		PackageDigest:    "sha256:" + strings.Repeat(string(packageDigit), 64),
		FormRef: FormRef{
			APIVersion:        "storage.forms.publisher.example",
			Kind:              "ObjectBucket",
			DefinitionVersion: "0.1.0",
			SchemaDigest:      "sha256:" + strings.Repeat(string(schemaDigit), 64),
		},
		ReasonCode: "signature-invalid",
		Summary:    "The retained signature cannot be validated.",
		IssuedAt:   "2026-08-28T00:00:00Z",
		Effects: RevocationEffects{
			BlockNewCreateOrUpdate:         true,
			BlockActivation:                true,
			RetainBytesForObserveAndDelete: true,
		},
	}
	raw, err := json.Marshal(statement)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := Canonicalize(raw)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := RevocationCheckpointEntryForStatement(canonical)
	if err != nil {
		t.Fatal(err)
	}
	return entry
}

func revocationCheckpointJSON(t *testing.T, checkpoint RevocationCheckpoint) []byte {
	t.Helper()
	raw, err := json.Marshal(checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := Canonicalize(raw)
	if err != nil {
		t.Fatal(err)
	}
	return canonical
}
