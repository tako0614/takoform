// Package genericconformance verifies the neutral Core artifact corpus.
//
// The package is deliberately data-only. It reads a caller-selected corpus,
// verifies every package and contract named by that corpus, and compiles the
// resulting inputs through the public snapshot package. It does not implement
// a Host, run lifecycle requests, or grant publication or support status.
package genericconformance

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/tako0614/takoform/formpackage"
	coresnapshot "github.com/tako0614/takoform/snapshot"
)

const (
	// CorpusFormat is the only corpus identity this runner accepts.
	CorpusFormat = "takoform.core-artifact-corpus@v1"
	// ReportFormat identifies the stable machine-readable verifier report.
	ReportFormat = "takoform.generic-conformance-report@v1"
	// HostAPILane is the served lane selected by the public Snapshot compiler.
	HostAPILane = "forms.takoform.com/v1"
)

// FormRef and contract references are aliases so callers can construct test
// manifests without importing the lower-level packages just for field types.
type FormRef = formpackage.FormRef
type InterfaceRef = formpackage.InterfaceRef
type BindingRef = formpackage.BindingRef
type DefaultPin = coresnapshot.DefaultPin

// PackageInput names one complete package directory. Path points at its
// package-index.json, while PackageDigest pins the canonical index bytes.
type PackageInput struct {
	Path          string `json:"path"`
	PackageDigest string `json:"packageDigest"`
}

// ContractInput names one exact Interface or Binding Definition file. The
// schemaDigest field pins the canonical definition bytes.
type ContractInput struct {
	Path         string `json:"path"`
	SchemaDigest string `json:"schemaDigest"`
}

// InterfaceInput and BindingInput are descriptive aliases for ContractInput.
type InterfaceInput = ContractInput
type BindingInput = ContractInput

// SnapshotInput is one complete, order-independent compiler input. The
// expected roster and default pins are assertions, not hints to the compiler.
type SnapshotInput struct {
	Name               string                     `json:"name"`
	Packages           []PackageInput             `json:"packages"`
	Interfaces         []ContractInput            `json:"interfaces"`
	Bindings           []ContractInput            `json:"bindings"`
	DefaultCreates     []DefaultPin               `json:"defaultCreates"`
	ExpectedFormRefs   []formpackage.FormRef      `json:"expectedFormRefs"`
	ExpectedInterfaces []formpackage.InterfaceRef `json:"expectedInterfaces,omitempty"`
	ExpectedBindings   []formpackage.BindingRef   `json:"expectedBindings,omitempty"`
}

// Manifest is the strict wire shape for the neutral artifact corpus.
// Deliberately absent are lifecycle checks, host probes, publisher claims, and
// any publisher-specific selector.
type Manifest struct {
	Format         string          `json:"format"`
	HostAPILane    string          `json:"hostApiLane"`
	SnapshotInputs []SnapshotInput `json:"snapshotInputs"`
}

// Check is one deterministic assertion executed by VerifyManifest.
type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// SnapshotReport records the immutable public view proved for one input.
type SnapshotReport struct {
	Name           string                   `json:"name"`
	SnapshotDigest string                   `json:"snapshotDigest"`
	FormRefs       []formpackage.FormRef    `json:"formRefs"`
	Interfaces     []coresnapshot.Interface `json:"interfaces"`
	Bindings       []coresnapshot.Binding   `json:"bindings"`
	Defaults       []DefaultReport          `json:"defaults"`
}

// DefaultReport records one exact group+kind create selection.
type DefaultReport struct {
	Group string              `json:"group"`
	Kind  string              `json:"kind"`
	Ref   formpackage.FormRef `json:"ref"`
}

// Report is stable JSON evidence. A failed run never contains a partial
// Snapshot; it may contain only reports for inputs completed before the first
// failure, and always carries Status="failed" plus Errors.
type Report struct {
	Format         string           `json:"format"`
	Status         string           `json:"status"`
	HostAPILane    string           `json:"hostApiLane"`
	ManifestDigest string           `json:"manifestDigest,omitempty"`
	Snapshots      []SnapshotReport `json:"snapshots"`
	Checks         []Check          `json:"checks"`
	Errors         []string         `json:"errors"`
}

// LoadManifest reads and strictly decodes one manifest. The returned bytes
// are the exact source bytes and are useful for recording provenance. The
// manifest path itself must be a regular non-symlink file.
func LoadManifest(manifestPath string) (Manifest, []byte, error) {
	abs, err := absoluteRegularPath(manifestPath)
	if err != nil {
		return Manifest{}, nil, err
	}
	manifestRoot, err := os.OpenRoot(filepath.Dir(abs))
	if err != nil {
		return Manifest{}, nil, fmt.Errorf("open manifest root: %w", err)
	}
	defer manifestRoot.Close()
	raw, err := readRegularRoot(manifestRoot, filepath.Base(abs))
	if err != nil {
		return Manifest{}, nil, fmt.Errorf("read manifest: %w", err)
	}
	var manifest Manifest
	if err := formpackage.DecodeStrictIJSON(raw, &manifest); err != nil {
		return Manifest{}, nil, fmt.Errorf("decode manifest: %w", err)
	}
	if err := validateManifestShape(manifest); err != nil {
		return Manifest{}, nil, err
	}
	return manifest, raw, nil
}

// Verify is an intentionally short alias for VerifyManifest.
func Verify(manifestPath string) (Report, error) { return VerifyManifest(manifestPath) }

// Run is an intentionally short alias for VerifyManifest, useful to command
// wrappers that expose a single verification operation.
func Run(manifestPath string) (Report, error) { return VerifyManifest(manifestPath) }

// VerifyManifest executes every Core corpus assertion. A non-nil error always
// accompanies a failed report; callers must not treat a report as evidence
// unless Status is exactly "passed" and error is nil.
func VerifyManifest(manifestPath string) (Report, error) {
	report := newReport()
	manifest, raw, err := LoadManifest(manifestPath)
	if err != nil {
		report.Errors = []string{err.Error()}
		return report, err
	}
	report.HostAPILane = manifest.HostAPILane
	report.ManifestDigest = formpackage.DigestBytes(raw)

	checks := []string{
		"manifest-identity",
		"safe-relative-paths",
		"package-and-contract-digests",
		"snapshot-compilation",
		"exact-roster-and-defaults",
		"contract-closure",
		"identity-separation",
		"permutation-stable",
		"no-partial-snapshot",
		"zero-family-closure",
	}

	compiled := make(map[string]*compiledInput, len(manifest.SnapshotInputs))
	root := filepath.Dir(mustAbsolute(manifestPath))
	corpusRoot, err := os.OpenRoot(root)
	if err != nil {
		return failReport(report, checks, fmt.Errorf("open corpus root: %w", err))
	}
	defer corpusRoot.Close()
	for _, input := range manifest.SnapshotInputs {
		entry, compileErr := compileInput(corpusRoot, root, manifest.HostAPILane, input)
		if compileErr != nil {
			return failReport(report, checks, compileErr)
		}
		compiled[input.Name] = entry
		report.Snapshots = append(report.Snapshots, entry.report)
	}
	sort.Slice(report.Snapshots, func(i, j int) bool { return report.Snapshots[i].Name < report.Snapshots[j].Name })

	if err := proveCorpus(compiled); err != nil {
		return failReport(report, checks, err)
	}
	for _, check := range checks {
		report.Checks = append(report.Checks, Check{Name: check, Status: "passed"})
	}
	report.Status = "passed"
	return report, nil
}

type compiledInput struct {
	snapshot *coresnapshot.Snapshot
	report   SnapshotReport
	input    SnapshotInput
	core     coresnapshot.Input
}

func newReport() Report {
	return Report{
		Format:    ReportFormat,
		Status:    "failed",
		Snapshots: make([]SnapshotReport, 0),
		Checks:    make([]Check, 0),
		Errors:    make([]string, 0),
	}
}

func failReport(report Report, checks []string, err error) (Report, error) {
	report.Status = "failed"
	report.Errors = append(report.Errors, err.Error())
	for _, check := range checks {
		found := false
		for _, existing := range report.Checks {
			if existing.Name == check {
				found = true
				break
			}
		}
		if !found {
			report.Checks = append(report.Checks, Check{Name: check, Status: "not-run"})
		}
	}
	return report, err
}

func validateManifestShape(manifest Manifest) error {
	if manifest.Format != CorpusFormat {
		return fmt.Errorf("manifest format %q is not %q", manifest.Format, CorpusFormat)
	}
	if manifest.HostAPILane != HostAPILane {
		return fmt.Errorf("manifest hostApiLane %q is not the selectable Core lane %q", manifest.HostAPILane, HostAPILane)
	}
	if len(manifest.SnapshotInputs) != 2 {
		return errors.New("manifest must contain exactly external-family and zero-family Snapshot inputs")
	}
	seen := make(map[string]struct{}, len(manifest.SnapshotInputs))
	for _, input := range manifest.SnapshotInputs {
		if input.Name == "" {
			return errors.New("Snapshot input name is required")
		}
		if _, exists := seen[input.Name]; exists {
			return fmt.Errorf("duplicate Snapshot input %q", input.Name)
		}
		seen[input.Name] = struct{}{}
	}
	if _, ok := seen["external-family"]; !ok {
		return errors.New("manifest is missing the external-family Snapshot input")
	}
	if _, ok := seen["zero-family"]; !ok {
		return errors.New("manifest is missing the zero-family Snapshot input")
	}
	return nil
}

func compileInput(corpusRoot *os.Root, root, hostAPI string, input SnapshotInput) (*compiledInput, error) {
	if input.Name == "" {
		return nil, errors.New("Snapshot input name is required")
	}
	packages := make([]coresnapshot.PackageArtifact, 0, len(input.Packages))
	interfaces := make([]coresnapshot.InterfaceArtifact, 0, len(input.Interfaces))
	bindings := make([]coresnapshot.BindingArtifact, 0, len(input.Bindings))
	packageDigests := make(map[formpackage.FormRef]string, len(input.Packages))
	seenPaths := make(map[string]struct{}, len(input.Packages)+len(input.Interfaces)+len(input.Bindings))

	for _, item := range input.Packages {
		indexPath, err := resolveRelative(root, item.Path, false)
		if err != nil {
			return nil, fmt.Errorf("Snapshot %s package path %q: %w", input.Name, item.Path, err)
		}
		if filepath.Base(indexPath) != formpackage.PackageIndexFilename {
			return nil, fmt.Errorf("Snapshot %s package path %q must name %s", input.Name, item.Path, formpackage.PackageIndexFilename)
		}
		if !formpackage.ValidDigest(item.PackageDigest) {
			return nil, fmt.Errorf("Snapshot %s package %q has a non-canonical package digest", input.Name, item.Path)
		}
		canonicalPath := path.Clean(item.Path)
		if _, exists := seenPaths[canonicalPath]; exists {
			return nil, fmt.Errorf("Snapshot %s repeats artifact path %q", input.Name, item.Path)
		}
		seenPaths[canonicalPath] = struct{}{}
		verification, err := verifyStagedPackage(corpusRoot, path.Dir(item.Path))
		if err != nil {
			return nil, fmt.Errorf("verify Snapshot %s package %q: %w", input.Name, item.Path, err)
		}
		verified, ok := verification.VerifiedPackage()
		if !ok {
			return nil, fmt.Errorf("verify Snapshot %s package %q issued no capability", input.Name, item.Path)
		}
		if got := verified.PackageDigest(); got != item.PackageDigest {
			return nil, fmt.Errorf("Snapshot %s package %q digest is %s, want %s", input.Name, item.Path, got, item.PackageDigest)
		}
		ref := verified.FormRef()
		if _, exists := packageDigests[ref]; exists {
			return nil, fmt.Errorf("Snapshot %s repeats exact FormRef %s", input.Name, formatFormRef(ref))
		}
		packageDigests[ref] = item.PackageDigest
		packages = append(packages, coresnapshot.PackageArtifact{
			Origin:         "generic-conformance://" + filepath.ToSlash(item.Path),
			ExpectedDigest: item.PackageDigest,
			Package:        verified,
		})
	}

	interfaceRefs := make([]formpackage.InterfaceRef, 0, len(input.Interfaces))
	for _, item := range input.Interfaces {
		if _, err := resolveRelative(root, item.Path, false); err != nil {
			return nil, fmt.Errorf("Snapshot %s Interface path %q: %w", input.Name, item.Path, err)
		}
		if _, exists := seenPaths[path.Clean(item.Path)]; exists {
			return nil, fmt.Errorf("Snapshot %s repeats artifact path %q", input.Name, item.Path)
		}
		seenPaths[path.Clean(item.Path)] = struct{}{}
		if !formpackage.ValidDigest(item.SchemaDigest) {
			return nil, fmt.Errorf("Snapshot %s Interface %q has a non-canonical digest", input.Name, item.Path)
		}
		raw, err := readRegularRoot(corpusRoot, item.Path)
		if err != nil {
			return nil, fmt.Errorf("read Snapshot %s Interface %q: %w", input.Name, item.Path, err)
		}
		ref, err := interfaceIdentity(raw, item.SchemaDigest)
		if err != nil {
			return nil, fmt.Errorf("Snapshot %s Interface %q: %w", input.Name, item.Path, err)
		}
		interfaceRefs = append(interfaceRefs, ref)
		interfaces = append(interfaces, coresnapshot.InterfaceArtifact{Origin: item.Path, ExpectedDigest: item.SchemaDigest, Definition: raw})
	}

	bindingRefs := make([]formpackage.BindingRef, 0, len(input.Bindings))
	for _, item := range input.Bindings {
		if _, err := resolveRelative(root, item.Path, false); err != nil {
			return nil, fmt.Errorf("Snapshot %s Binding path %q: %w", input.Name, item.Path, err)
		}
		if _, exists := seenPaths[path.Clean(item.Path)]; exists {
			return nil, fmt.Errorf("Snapshot %s repeats artifact path %q", input.Name, item.Path)
		}
		seenPaths[path.Clean(item.Path)] = struct{}{}
		if !formpackage.ValidDigest(item.SchemaDigest) {
			return nil, fmt.Errorf("Snapshot %s Binding %q has a non-canonical digest", input.Name, item.Path)
		}
		raw, err := readRegularRoot(corpusRoot, item.Path)
		if err != nil {
			return nil, fmt.Errorf("read Snapshot %s Binding %q: %w", input.Name, item.Path, err)
		}
		ref, err := bindingIdentity(raw, item.SchemaDigest)
		if err != nil {
			return nil, fmt.Errorf("Snapshot %s Binding %q: %w", input.Name, item.Path, err)
		}
		bindingRefs = append(bindingRefs, ref)
		bindings = append(bindings, coresnapshot.BindingArtifact{Origin: item.Path, ExpectedDigest: item.SchemaDigest, Definition: raw})
	}

	coreInput := coresnapshot.Input{
		HostAPI: hostAPI, Packages: packages, Interfaces: interfaces, Bindings: bindings,
		DefaultCreates: append([]coresnapshot.DefaultPin(nil), input.DefaultCreates...),
	}
	compiled, diagnostics := coresnapshot.Compile(coreInput)
	if compiled == nil || len(diagnostics) != 0 {
		return nil, fmt.Errorf("Snapshot %s did not compile completely: %s", input.Name, formatDiagnostics(diagnostics))
	}
	if compiled.HostAPI() != hostAPI || !formpackage.ValidDigest(compiled.Digest()) {
		return nil, fmt.Errorf("Snapshot %s returned incomplete identity", input.Name)
	}
	if err := assertSnapshotRoster(input, compiled, packageDigests, interfaceRefs, bindingRefs); err != nil {
		return nil, err
	}
	if err := assertPermutationStable(coreInput, compiled, input.Name); err != nil {
		return nil, err
	}
	if err := assertNoPartialCompilation(coreInput, input.Name); err != nil {
		return nil, err
	}

	formRefs := make([]formpackage.FormRef, 0, len(compiled.Forms()))
	for _, form := range compiled.Forms() {
		formRefs = append(formRefs, form.Ref)
	}
	defaults := make([]DefaultReport, 0, len(input.DefaultCreates))
	for _, pin := range sortedDefaultPins(input.DefaultCreates) {
		defaults = append(defaults, DefaultReport{Group: pin.Group, Kind: pin.Kind, Ref: pin.Ref})
	}
	return &compiledInput{
		snapshot: compiled, input: input, core: coreInput,
		report: SnapshotReport{
			Name: input.Name, SnapshotDigest: compiled.Digest(), FormRefs: formRefs,
			Interfaces: append([]coresnapshot.Interface{}, compiled.Interfaces()...),
			Bindings:   append([]coresnapshot.Binding{}, compiled.Bindings()...), Defaults: defaults,
		},
	}, nil
}

func assertSnapshotRoster(input SnapshotInput, compiled *coresnapshot.Snapshot, packageDigests map[formpackage.FormRef]string, interfaceRefs []formpackage.InterfaceRef, bindingRefs []formpackage.BindingRef) error {
	gotForms := make([]formpackage.FormRef, 0, len(compiled.Forms()))
	for _, form := range compiled.Forms() {
		wantDigest, ok := packageDigests[form.Ref]
		if !ok || wantDigest != form.PackageDigest {
			return fmt.Errorf("Snapshot %s changed package provenance for %s", input.Name, formatFormRef(form.Ref))
		}
		gotForms = append(gotForms, form.Ref)
	}
	if !equalFormRefs(gotForms, input.ExpectedFormRefs) {
		return fmt.Errorf("Snapshot %s exact Form roster drifted: got %v, want %v", input.Name, gotForms, input.ExpectedFormRefs)
	}
	gotInterfaces := compiled.Interfaces()
	wantInterfaces := append([]formpackage.InterfaceRef{}, interfaceRefs...)
	sort.Slice(wantInterfaces, func(i, j int) bool { return lessInterfaceRef(wantInterfaces[i], wantInterfaces[j]) })
	if len(input.ExpectedInterfaces) != 0 {
		if !equalInterfaceRefs(gotInterfaceRefs(gotInterfaces), sortedInterfaceRefs(input.ExpectedInterfaces)) {
			return fmt.Errorf("Snapshot %s exact Interface roster drifted", input.Name)
		}
	} else if !equalInterfaceRefs(gotInterfaceRefs(gotInterfaces), wantInterfaces) {
		return fmt.Errorf("Snapshot %s Interface artifact roster drifted", input.Name)
	}
	gotBindings := compiled.Bindings()
	wantBindings := append([]formpackage.BindingRef{}, bindingRefs...)
	sort.Slice(wantBindings, func(i, j int) bool { return lessBindingRef(wantBindings[i], wantBindings[j]) })
	if len(input.ExpectedBindings) != 0 {
		if !equalBindingRefs(gotBindingRefs(gotBindings), sortedBindingRefs(input.ExpectedBindings)) {
			return fmt.Errorf("Snapshot %s exact Binding roster drifted", input.Name)
		}
	} else if !equalBindingRefs(gotBindingRefs(gotBindings), wantBindings) {
		return fmt.Errorf("Snapshot %s Binding artifact roster drifted", input.Name)
	}
	for _, pin := range input.DefaultCreates {
		got, ok := compiled.Default(pin.Group, pin.Kind)
		if !ok || got != pin.Ref {
			return fmt.Errorf("Snapshot %s default for %s/%s drifted", input.Name, pin.Group, pin.Kind)
		}
	}
	if len(input.ExpectedFormRefs) == 0 {
		if len(input.Packages) != 0 || len(input.Interfaces) != 0 || len(input.Bindings) != 0 || len(input.DefaultCreates) != 0 || len(gotInterfaces) != 0 || len(gotBindings) != 0 {
			return fmt.Errorf("Snapshot %s zero-family input carries hidden artifacts", input.Name)
		}
	}
	return nil
}

func assertPermutationStable(input coresnapshot.Input, original *coresnapshot.Snapshot, name string) error {
	reversed := input
	reversed.Packages = reversePackages(input.Packages)
	reversed.Interfaces = reverseInterfaces(input.Interfaces)
	reversed.Bindings = reverseBindings(input.Bindings)
	reversed.DefaultCreates = reverseDefaults(input.DefaultCreates)
	permuted, diagnostics := coresnapshot.Compile(reversed)
	if permuted == nil || len(diagnostics) != 0 {
		return fmt.Errorf("Snapshot %s permutation failed to compile: %s", name, formatDiagnostics(diagnostics))
	}
	if permuted.Digest() != original.Digest() {
		return fmt.Errorf("Snapshot %s permutation changed digest %s -> %s", name, original.Digest(), permuted.Digest())
	}
	return nil
}

func assertNoPartialCompilation(input coresnapshot.Input, name string) error {
	if len(input.Packages) == 0 {
		return nil
	}
	tampered := input
	tampered.Packages = append([]coresnapshot.PackageArtifact(nil), input.Packages...)
	tampered.Packages[0].ExpectedDigest = "sha256:" + strings.Repeat("0", 64)
	partial, diagnostics := coresnapshot.Compile(tampered)
	if partial != nil || len(diagnostics) == 0 {
		return fmt.Errorf("Snapshot %s compiler returned a partial result for a tampered package", name)
	}
	duplicate := input
	duplicate.Packages = append([]coresnapshot.PackageArtifact(nil), input.Packages...)
	duplicate.Packages = append(duplicate.Packages, input.Packages[0])
	partial, diagnostics = coresnapshot.Compile(duplicate)
	if partial != nil || len(diagnostics) == 0 {
		return fmt.Errorf("Snapshot %s compiler returned a partial result for a duplicate package", name)
	}
	return nil
}

func proveCorpus(compiled map[string]*compiledInput) error {
	zero, zeroOK := compiled["zero-family"]
	external, externalOK := compiled["external-family"]
	if !zeroOK || !externalOK {
		return errors.New("corpus did not compile both external-family and zero-family inputs")
	}
	if len(zero.snapshot.Forms()) != 0 || len(zero.snapshot.Interfaces()) != 0 || len(zero.snapshot.Bindings()) != 0 || len(zero.input.DefaultCreates) != 0 {
		return errors.New("zero-family Snapshot is not empty")
	}
	if !formpackage.ValidDigest(zero.snapshot.Digest()) {
		return errors.New("zero-family Snapshot has no deterministic digest")
	}
	if len(external.snapshot.Forms()) == 0 {
		return errors.New("external-family Snapshot is empty")
	}
	groupsByKind := make(map[string]map[string]struct{})
	versionsByIdentity := make(map[string]map[string]struct{})
	for _, form := range external.snapshot.Forms() {
		groupsByKind[form.Ref.Kind] = ensureSet(groupsByKind[form.Ref.Kind])
		groupsByKind[form.Ref.Kind][form.Ref.APIVersion] = struct{}{}
		identity := form.Ref.APIVersion + "\x00" + form.Ref.Kind
		versionsByIdentity[identity] = ensureSet(versionsByIdentity[identity])
		versionsByIdentity[identity][form.Ref.DefinitionVersion] = struct{}{}
	}
	groupProof := false
	for _, groups := range groupsByKind {
		if len(groups) >= 2 {
			groupProof = true
			break
		}
	}
	if !groupProof {
		return errors.New("external-family Snapshot does not prove same Kind remains distinct across reverse-DNS groups")
	}
	versionProof := false
	for _, versions := range versionsByIdentity {
		if len(versions) >= 2 {
			versionProof = true
			break
		}
	}
	if !versionProof {
		return errors.New("external-family Snapshot does not prove a second definition version coexists")
	}
	return nil
}

func ensureSet[T comparable](set map[T]struct{}) map[T]struct{} {
	if set == nil {
		return make(map[T]struct{})
	}
	return set
}

func interfaceIdentity(raw []byte, expected string) (formpackage.InterfaceRef, error) {
	if err := formpackage.ValidateInterfaceDefinition(raw); err != nil {
		return formpackage.InterfaceRef{}, err
	}
	digest, err := formpackage.DigestCanonicalJSON(raw)
	if err != nil {
		return formpackage.InterfaceRef{}, err
	}
	if digest != expected {
		return formpackage.InterfaceRef{}, fmt.Errorf("definition digest is %s, want %s", digest, expected)
	}
	var document struct {
		APIVersion string `json:"apiVersion"`
		Name       string `json:"name"`
		Version    string `json:"version"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return formpackage.InterfaceRef{}, err
	}
	return formpackage.InterfaceRef{APIVersion: document.APIVersion, Name: document.Name, Version: document.Version, SchemaDigest: digest}, nil
}

func bindingIdentity(raw []byte, expected string) (formpackage.BindingRef, error) {
	if err := formpackage.ValidateBindingDefinition(raw); err != nil {
		return formpackage.BindingRef{}, err
	}
	digest, err := formpackage.DigestCanonicalJSON(raw)
	if err != nil {
		return formpackage.BindingRef{}, err
	}
	if digest != expected {
		return formpackage.BindingRef{}, fmt.Errorf("definition digest is %s, want %s", digest, expected)
	}
	var document struct {
		APIVersion string `json:"apiVersion"`
		Name       string `json:"name"`
		Version    string `json:"version"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return formpackage.BindingRef{}, err
	}
	return formpackage.BindingRef{APIVersion: document.APIVersion, Name: document.Name, Version: document.Version, SchemaDigest: digest}, nil
}

func resolveRelative(root, relative string, wantDir bool) (string, error) {
	if root == "" {
		return "", errors.New("manifest root is empty")
	}
	if relative == "" || strings.ContainsRune(relative, '\x00') || strings.Contains(relative, "\\") || filepath.IsAbs(relative) || path.IsAbs(filepath.ToSlash(relative)) {
		return "", errors.New("path must be a relative slash-separated path")
	}
	slash := filepath.ToSlash(relative)
	if slash == "." || !validRelativePath(slash) || path.Clean(slash) != slash {
		return "", errors.New("path must not contain traversal or dot segments")
	}
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return "", err
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return "", errors.New("manifest root is not a non-symlink directory")
	}
	current := root
	parts := strings.Split(slash, "/")
	for index, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("path component %q is a symlink", strings.Join(parts[:index+1], "/"))
		}
		last := index == len(parts)-1
		if last {
			if wantDir && !info.IsDir() {
				return "", errors.New("path is not a directory")
			}
			if !wantDir && !info.Mode().IsRegular() {
				return "", errors.New("path is not a regular file")
			}
		} else if !info.IsDir() {
			return "", fmt.Errorf("path component %q is not a directory", strings.Join(parts[:index+1], "/"))
		}
	}
	return current, nil
}

func validRelativePath(value string) bool {
	if value == "" || value == "." || strings.HasPrefix(value, "/") {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func absoluteRegularPath(input string) (string, error) {
	if strings.TrimSpace(input) == "" {
		return "", errors.New("manifest path is required")
	}
	abs, err := filepath.Abs(input)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", errors.New("manifest path must be a non-symlink regular file")
	}
	return abs, nil
}

func mustAbsolute(input string) string {
	abs, err := filepath.Abs(input)
	if err != nil {
		return input
	}
	return abs
}

func readRegularRoot(root *os.Root, relative string) ([]byte, error) {
	if relative == "" || strings.ContainsRune(relative, '\x00') || strings.Contains(relative, "\\") ||
		path.IsAbs(relative) || path.Clean(relative) != relative || !validRelativePath(relative) {
		return nil, errors.New("file path must be a clean relative slash-separated path")
	}
	before, err := root.Lstat(relative)
	if err != nil {
		return nil, err
	}
	if before.Mode()&os.ModeSymlink != 0 || !before.Mode().IsRegular() {
		return nil, errors.New("file is not a non-symlink regular file")
	}
	// os.Root performs descriptor-relative traversal and rejects absolute or
	// outward-pointing symlinks. The metadata fences retain the stronger rule
	// that corpus entries themselves must be ordinary, stable files.
	handle, err := root.Open(relative)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	opened, err := handle.Stat()
	if err != nil {
		return nil, err
	}
	if !os.SameFile(before, opened) || opened.Mode()&os.ModeSymlink != 0 || !opened.Mode().IsRegular() {
		return nil, errors.New("file changed while opening")
	}
	raw, err := io.ReadAll(handle)
	if err != nil {
		return nil, err
	}
	after, err := root.Lstat(relative)
	if err != nil {
		return nil, err
	}
	if !os.SameFile(before, after) || after.Size() != int64(len(raw)) || after.Mode()&os.ModeSymlink != 0 || !after.Mode().IsRegular() {
		return nil, errors.New("file changed while reading")
	}
	return raw, nil
}

func verifyStagedPackage(corpusRoot *os.Root, relativeDir string) (formpackage.VerificationReport, error) {
	staged, err := stagePackage(corpusRoot, relativeDir)
	if err != nil {
		return formpackage.VerificationReport{}, err
	}
	defer os.RemoveAll(staged)
	return formpackage.VerifyDirectory(staged)
}

// stagePackage copies one caller-selected package closure through os.Root into
// a fresh private directory. Even if an ancestor is exchanged between a path
// check and an open, Root cannot follow it outside the held corpus root. The
// ordinary Form Package verifier then consumes only the immutable staged copy.
func stagePackage(corpusRoot *os.Root, relativeDir string) (string, error) {
	if relativeDir != "." && (!validRelativePath(relativeDir) || path.Clean(relativeDir) != relativeDir) {
		return "", errors.New("package directory must be a clean relative slash-separated path")
	}
	staged, err := os.MkdirTemp("", "takoform-generic-package-")
	if err != nil {
		return "", err
	}
	failed := true
	defer func() {
		if failed {
			_ = os.RemoveAll(staged)
		}
	}()

	err = fs.WalkDir(corpusRoot.FS(), relativeDir, func(source string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("package path %q is a symlink", source)
		}
		relative := strings.TrimPrefix(source, relativeDir)
		relative = strings.TrimPrefix(relative, "/")
		if relative == "" {
			return nil
		}
		target := filepath.Join(staged, filepath.FromSlash(relative))
		if entry.IsDir() {
			return os.Mkdir(target, 0o700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("package path %q is not a regular file", source)
		}
		raw, err := readRegularRoot(corpusRoot, source)
		if err != nil {
			return fmt.Errorf("stage package path %q: %w", source, err)
		}
		return os.WriteFile(target, raw, 0o600)
	})
	if err != nil {
		return "", err
	}
	failed = false
	return staged, nil
}

func formatDiagnostics(diagnostics []coresnapshot.Diagnostic) string {
	if len(diagnostics) == 0 {
		return "no diagnostics"
	}
	parts := make([]string, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		parts = append(parts, string(diagnostic.Code)+"("+diagnostic.Subject+")")
	}
	return strings.Join(parts, ", ")
}

func formatFormRef(ref formpackage.FormRef) string {
	return ref.APIVersion + "/" + ref.Kind + "@" + ref.DefinitionVersion + "#" + ref.SchemaDigest
}

func lessInterfaceRef(a, b formpackage.InterfaceRef) bool {
	if a.APIVersion != b.APIVersion {
		return a.APIVersion < b.APIVersion
	}
	if a.Name != b.Name {
		return a.Name < b.Name
	}
	if a.Version != b.Version {
		return a.Version < b.Version
	}
	return a.SchemaDigest < b.SchemaDigest
}

func lessBindingRef(a, b formpackage.BindingRef) bool {
	if a.APIVersion != b.APIVersion {
		return a.APIVersion < b.APIVersion
	}
	if a.Name != b.Name {
		return a.Name < b.Name
	}
	if a.Version != b.Version {
		return a.Version < b.Version
	}
	return a.SchemaDigest < b.SchemaDigest
}

func gotInterfaceRefs(values []coresnapshot.Interface) []formpackage.InterfaceRef {
	output := make([]formpackage.InterfaceRef, 0, len(values))
	for _, value := range values {
		output = append(output, value.Ref)
	}
	return output
}

func gotBindingRefs(values []coresnapshot.Binding) []formpackage.BindingRef {
	output := make([]formpackage.BindingRef, 0, len(values))
	for _, value := range values {
		output = append(output, value.Ref)
	}
	return output
}

func equalFormRefs(left, right []formpackage.FormRef) bool {
	if len(left) != len(right) {
		return false
	}
	return reflect.DeepEqual(left, right)
}

func equalInterfaceRefs(left, right []formpackage.InterfaceRef) bool {
	if len(left) != len(right) {
		return false
	}
	return reflect.DeepEqual(left, right)
}

func equalBindingRefs(left, right []formpackage.BindingRef) bool {
	if len(left) != len(right) {
		return false
	}
	return reflect.DeepEqual(left, right)
}

func sortedInterfaceRefs(values []formpackage.InterfaceRef) []formpackage.InterfaceRef {
	output := append([]formpackage.InterfaceRef(nil), values...)
	sort.Slice(output, func(i, j int) bool { return lessInterfaceRef(output[i], output[j]) })
	return output
}

func sortedBindingRefs(values []formpackage.BindingRef) []formpackage.BindingRef {
	output := append([]formpackage.BindingRef(nil), values...)
	sort.Slice(output, func(i, j int) bool { return lessBindingRef(output[i], output[j]) })
	return output
}

func sortedDefaultPins(values []DefaultPin) []DefaultPin {
	output := append([]DefaultPin(nil), values...)
	sort.Slice(output, func(i, j int) bool {
		if output[i].Group != output[j].Group {
			return output[i].Group < output[j].Group
		}
		return output[i].Kind < output[j].Kind
	})
	return output
}

func reversePackages(values []coresnapshot.PackageArtifact) []coresnapshot.PackageArtifact {
	output := append([]coresnapshot.PackageArtifact(nil), values...)
	for left, right := 0, len(output)-1; left < right; left, right = left+1, right-1 {
		output[left], output[right] = output[right], output[left]
	}
	return output
}

func reverseInterfaces(values []coresnapshot.InterfaceArtifact) []coresnapshot.InterfaceArtifact {
	output := append([]coresnapshot.InterfaceArtifact(nil), values...)
	for left, right := 0, len(output)-1; left < right; left, right = left+1, right-1 {
		output[left], output[right] = output[right], output[left]
	}
	return output
}

func reverseBindings(values []coresnapshot.BindingArtifact) []coresnapshot.BindingArtifact {
	output := append([]coresnapshot.BindingArtifact(nil), values...)
	for left, right := 0, len(output)-1; left < right; left, right = left+1, right-1 {
		output[left], output[right] = output[right], output[left]
	}
	return output
}

func reverseDefaults(values []coresnapshot.DefaultPin) []coresnapshot.DefaultPin {
	output := append([]coresnapshot.DefaultPin(nil), values...)
	for left, right := 0, len(output)-1; left < right; left, right = left+1, right-1 {
		output[left], output[right] = output[right], output[left]
	}
	return output
}
