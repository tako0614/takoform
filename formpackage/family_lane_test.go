package formpackage

import (
	"path/filepath"
	"strings"
	"testing"
)

const testFamilyGroup = "resources.publisher.example/v1beta1"

func familyPortableMapKeys() map[string]any {
	return map[string]any{
		"type":                   "string",
		"pattern":                portableMapKeyPattern,
		"x-takoform-fieldPolicy": "portable-data-only-v1",
	}
}

func makeFamilyDefinition() map[string]any {
	return map[string]any{
		"apiVersion":        testFamilyGroup,
		"kind":              "ExampleRevision",
		"definitionVersion": "0.1.0",
		"title":             "Example revision",
		"description":       "Example immutable revision Form for the family lane tests.",
		"role":              "revision",
		"desiredSchema": map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"type":                 "object",
			"additionalProperties": false,
			"title":                "Example revision desired state",
			"required":             []any{"mainModule"},
			"properties": map[string]any{
				"mainModule": map[string]any{
					"type":    "string",
					"pattern": `^[A-Za-z0-9_][A-Za-z0-9._-]*(?:/[A-Za-z0-9_][A-Za-z0-9._-]*)*$`,
				},
				"vars": map[string]any{
					"type":                 "object",
					"propertyNames":        familyPortableMapKeys(),
					"additionalProperties": map[string]any{"$ref": "#/$defs/varsValue1"},
				},
			},
			"$defs": map[string]any{
				"varsValue1": map[string]any{
					"type":                 []any{"array", "boolean", "null", "number", "object", "string"},
					"items":                map[string]any{"$ref": "#/$defs/varsValue2"},
					"propertyNames":        familyPortableMapKeys(),
					"additionalProperties": map[string]any{"$ref": "#/$defs/varsValue2"},
				},
				"varsValue2": map[string]any{
					"type": []any{"boolean", "null", "number", "string"},
				},
			},
		},
		"immutableFields":       []any{"/mainModule", "/vars"},
		"lifecycleCapabilities": []any{"create", "read", "delete", "import", "observe"},
		"providedInterfaces": []any{
			map[string]any{
				"apiVersion":   "interfaces.takoform.com/v1alpha1",
				"name":         "example.kv",
				"version":      "1.0.0",
				"schemaDigest": "sha256:" + strings.Repeat("a", 64),
			},
		},
		"acceptedBindings": []any{
			map[string]any{
				"apiVersion":   "bindings.takoform.com/v1alpha1",
				"name":         "runtime-job.example-kv",
				"version":      "1.0.0",
				"schemaDigest": "sha256:" + strings.Repeat("b", 64),
			},
		},
		"conformanceFixtures": []any{
			map[string]any{"name": "canonical", "desiredPath": "fixtures/desired.json"},
		},
		"negativeConformanceFixtures": []any{
			map[string]any{
				"name":            "reject-missing-main-module",
				"stage":           "desired",
				"inputPath":       "fixtures/negative-missing-main-module.json",
				"expectedFailure": "schema_validation_failed",
			},
		},
	}
}

func makeFamilyPackageForGeneration(t *testing.T, packageAPIVersion string, mutateDefinition func(map[string]any)) string {
	t.Helper()
	root := t.TempDir()
	definition := makeFamilyDefinition()
	if mutateDefinition != nil {
		mutateDefinition(definition)
	}
	definitionRaw := canonicalMarshal(t, definition)
	desiredRaw := []byte(`{"mainModule":"worker.mjs","vars":{"LOG_LEVEL":"info","nested":{"depth":2}}}`)
	negativeRaw := []byte(`{"vars":{"LOG_LEVEL":"info"}}`)
	writeFixtureFile(t, filepath.Join(root, "definition.json"), definitionRaw, 0o644)
	writeFixtureFile(t, filepath.Join(root, "fixtures", "desired.json"), desiredRaw, 0o644)
	writeFixtureFile(t, filepath.Join(root, "fixtures", "negative-missing-main-module.json"), negativeRaw, 0o644)
	index := map[string]any{
		"apiVersion": packageAPIVersion,
		"kind":       PackageKind,
		"formRef": map[string]any{
			"apiVersion":        definition["apiVersion"],
			"kind":              definition["kind"],
			"definitionVersion": definition["definitionVersion"],
			"schemaDigest":      mustDigestCanonical(t, definitionRaw),
		},
		"definitionPath": "definition.json",
		"files": []any{
			fileEntry("definition.json", DefinitionMediaType, definitionRaw),
			fileEntry("fixtures/desired.json", "application/json", desiredRaw),
			fileEntry("fixtures/negative-missing-main-module.json", "application/json", negativeRaw),
		},
	}
	writeFixtureFile(t, filepath.Join(root, PackageIndexFilename), canonicalMarshal(t, index), 0o644)
	return root
}

func makeFamilyPackage(t *testing.T, mutateDefinition func(map[string]any)) string {
	t.Helper()
	return makeFamilyPackageForGeneration(t, FamilyPackageAPIVersion, mutateDefinition)
}

func makeCurrentFamilyPackage(t *testing.T, mutateDefinition func(map[string]any)) string {
	t.Helper()
	return makeFamilyPackageForGeneration(t, VersionlessFamilyPackageAPIVersion, func(definition map[string]any) {
		definition["apiVersion"] = "resources.publisher.example"
		definition["requiresHostApi"] = stableHostAPIVersion
		binding := definition["acceptedBindings"].([]any)[0].(map[string]any)
		binding["apiVersion"] = "bindings.takoform.com/v1alpha2"
		if mutateDefinition != nil {
			mutateDefinition(definition)
		}
	})
}

func TestVerifyDirectoryAcceptsFamilyV1Alpha4Package(t *testing.T) {
	t.Parallel()
	root := makeFamilyPackage(t, nil)
	report, err := VerifyDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	if report.FormRef.APIVersion != testFamilyGroup || report.FormRef.Kind != "ExampleRevision" || report.FileCount != 3 {
		t.Fatalf("unexpected report: %+v", report)
	}
}

func TestFamilyDefinitionRejectsRevisionUpdateCapability(t *testing.T) {
	t.Parallel()
	root := makeFamilyPackage(t, func(definition map[string]any) {
		definition["lifecycleCapabilities"] = []any{"create", "read", "update", "delete"}
	})
	if _, err := VerifyDirectory(root); err == nil {
		t.Fatal("revision Form with the update capability unexpectedly verified")
	}
}

func TestCurrentFamilyDefinitionAcceptsBindingsForDeclaredNonRevisionRole(t *testing.T) {
	t.Parallel()
	root := makeCurrentFamilyPackage(t, func(definition map[string]any) {
		definition["role"] = "identity"
		definition["lifecycleCapabilities"] = []any{"create", "read", "update", "delete", "import", "observe"}
	})
	if _, err := VerifyDirectory(root); err != nil {
		t.Fatalf("identity Form with a declared capability binding was rejected: %v", err)
	}
}

func TestPackageGenerationAloneSelectsTheFamilySchema(t *testing.T) {
	t.Parallel()
	if _, err := VerifyDirectory(makeFamilyPackage(t, nil)); err != nil {
		t.Fatalf("retained v1alpha4 profile rejected its synthetic versioned Definition: %v", err)
	}
	if _, err := VerifyDirectory(makeCurrentFamilyPackage(t, nil)); err != nil {
		t.Fatalf("current v1alpha5 profile rejected its synthetic neutral Definition: %v", err)
	}

	currentBytesInRetainedEnvelope := makeFamilyPackage(t, func(definition map[string]any) {
		definition["requiresHostApi"] = stableHostAPIVersion
	})
	if _, err := VerifyDirectory(currentBytesInRetainedEnvelope); err == nil {
		t.Fatal("v1alpha4 package inferred the current profile from publisher-owned Definition bytes")
	}

	retainedBytesInCurrentEnvelope := makeFamilyPackageForGeneration(t, VersionlessFamilyPackageAPIVersion, func(definition map[string]any) {
		definition["apiVersion"] = "resources.publisher.example"
	})
	if _, err := VerifyDirectory(retainedBytesInCurrentEnvelope); err == nil {
		t.Fatal("v1alpha5 package inferred a retained profile from publisher-owned Definition bytes")
	}
}

func TestFamilyDefinitionRejectsFrozenCentralGroups(t *testing.T) {
	t.Parallel()
	for _, frozen := range []string{LegacyFormAPIVersion, CurrentFormAPIVersion} {
		definition := makeFamilyDefinition()
		definition["apiVersion"] = frozen
		if _, err := ValidateDefinition(canonicalMarshal(t, definition)); err == nil {
			t.Fatalf("frozen group %s unexpectedly accepted by the family definition lane", frozen)
		}
	}
}

func TestFamilyFormRefAcceptsNamespacedGroups(t *testing.T) {
	t.Parallel()
	ref := map[string]any{
		"apiVersion":        "forms.example.com",
		"kind":              "ExampleStore",
		"definitionVersion": "0.1.0",
		"schemaDigest":      "sha256:" + strings.Repeat("c", 64),
	}
	parsed, err := validateFormRef(canonicalMarshal(t, ref))
	if err != nil {
		t.Fatalf("valid third-party family FormRef rejected: %v", err)
	}
	if parsed.APIVersion != "forms.example.com" {
		t.Fatalf("parsed FormRef = %+v", parsed)
	}
	for name, invalid := range map[string]string{
		"dotless group":       "forms/v1",
		"uppercase group":     "Forms.Example.com/v1alpha1",
		"malformed version":   "forms.example.com/version1",
		"frozen legacy group": LegacyFormAPIVersion + "x",
		// A versionless group is legal since decision 0049, so what a reserved
		// name must not gain from that is a way in without a version.
		"bare host api domain":   "forms.takoform.com",
		"bare package namespace": "packages.forms.takoform.com",
		"bare trust namespace":   "trust.forms.takoform.com",
	} {
		candidate := map[string]any{
			"apiVersion":        invalid,
			"kind":              "ExampleStore",
			"definitionVersion": "0.1.0",
			"schemaDigest":      "sha256:" + strings.Repeat("c", 64),
		}
		if _, err := validateFormRef(canonicalMarshal(t, candidate)); err == nil {
			t.Errorf("%s: FormRef apiVersion %q unexpectedly accepted", name, invalid)
		}
	}
}

func TestFamilyPackagePublicationIdentity(t *testing.T) {
	t.Parallel()
	index := PackageIndex{
		APIVersion: FamilyPackageAPIVersion,
		Kind:       PackageKind,
		FormRef: FormRef{
			APIVersion:        testFamilyGroup,
			Kind:              "ObjectBucket",
			DefinitionVersion: "0.1.0",
			SchemaDigest:      "sha256:" + strings.Repeat("d", 64),
		},
		DefinitionPath: "definition.json",
	}
	packageDigest := "sha256:" + strings.Repeat("e", 64)
	locator, err := PublicationLocatorFor(index, packageDigest)
	if err != nil {
		t.Fatal(err)
	}
	wantReleaseID := ReleaseIDForGroupKind(testFamilyGroup, "ObjectBucket")
	if locator.ReleaseID != wantReleaseID {
		t.Fatalf("release id = %q, want %q", locator.ReleaseID, wantReleaseID)
	}
	if locator.ReleaseID == ReleaseIDForKind("ObjectBucket") {
		t.Fatal("family release id must not collide with the frozen central ObjectBucket release line")
	}
	if locator.ArtifactID != strings.Replace(packageDigest, ":", "-", 1) {
		t.Fatalf("artifact id = %q", locator.ArtifactID)
	}
	decoded, err := KindFromReleaseID(locator.ReleaseID)
	if err != nil {
		t.Fatal(err)
	}
	if decoded != testFamilyGroup+"/ObjectBucket" {
		t.Fatalf("release id decodes to %q", decoded)
	}

	index.PackageVersion = "1.0.0"
	if _, err := PublicationLocatorFor(index, packageDigest); err == nil {
		t.Fatal("v1alpha4 publication identity unexpectedly accepted packageVersion")
	}
	index.PackageVersion = ""
	index.FormRef.APIVersion = CurrentFormAPIVersion
	if _, err := PublicationLocatorFor(index, packageDigest); err == nil {
		t.Fatal("v1alpha4 publication identity unexpectedly accepted a frozen central group")
	}
}
