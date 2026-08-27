package formpackage

// family_publication_lane_test.go pins the publication lane a tag belongs to.
// A Form Family release id encodes "<group>/<Kind>", while the retained central
// lanes encode a bare Kind. That distinguishes family from central tags, but a
// central digest tag still needs its package envelope to distinguish v1alpha2
// from v1alpha3.

import (
	"strings"
	"testing"
)

func TestParsePublicationTagRoundTripsTheFamilyLane(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		group string
		kind  string
	}{
		"versioned family": {group: testFamilyGroup, kind: "ObjectBucket"},
		"external family":  {group: "forms.example.com/v1alpha1", kind: "ExampleStore"},
	} {
		name, testCase := name, testCase
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			packageDigest := "sha256:" + strings.Repeat("e", 64)
			index := PackageIndex{
				APIVersion: FamilyPackageAPIVersion,
				Kind:       PackageKind,
				FormRef: FormRef{
					APIVersion:        testCase.group,
					Kind:              testCase.kind,
					DefinitionVersion: "0.1.0",
					SchemaDigest:      "sha256:" + strings.Repeat("d", 64),
				},
				DefinitionPath: "definition.json",
			}
			locator, err := PublicationLocatorFor(index, packageDigest)
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := ParsePublicationTag(locator.Tag)
			if err != nil {
				t.Fatalf("family tag %q did not parse: %v", locator.Tag, err)
			}
			if parsed.APIVersion != FamilyPackageAPIVersion {
				t.Fatalf("family tag parsed as %q, want %q", parsed.APIVersion, FamilyPackageAPIVersion)
			}
			if parsed.ReleaseID != locator.ReleaseID || parsed.ArtifactID != locator.ArtifactID ||
				parsed.Tag != locator.Tag || parsed.SourcePath != locator.SourcePath {
				t.Fatalf("family locator did not round-trip: %#v vs %#v", parsed, locator)
			}
			group, kind, family := FamilyReleaseID(parsed.ReleaseID)
			if !family || group != testCase.group || kind != testCase.kind {
				t.Fatalf("release id decoded to (%q, %q, %v), want (%q, %q, true)",
					group, kind, family, testCase.group, testCase.kind)
			}
		})
	}
}

// TestPublicationTagParsingKeepsTheRetainedLanesByteCompatible proves explicit
// central-generation parsing changes none of the tags that already exist.
func TestPublicationTagParsingKeepsTheRetainedLanesByteCompatible(t *testing.T) {
	t.Parallel()
	releaseID := ReleaseIDForKind("ExampleStore")
	digestArtifact := "sha256-" + strings.Repeat("d", 64)

	for name, testCase := range map[string]struct {
		tag            string
		wantAPIVersion string
		wantArtifactID string
		wantSourcePath string
	}{
		"retained v1alpha1 SemVer lane": {
			tag:            "forms/" + releaseID + "/v1.2.3",
			wantAPIVersion: PackageAPIVersion,
			wantArtifactID: "1.2.3",
			wantSourcePath: "forms/releases/" + releaseID + "/1.2.3",
		},
		"retained content-addressed central lane": {
			tag:            "forms/" + releaseID + "/" + digestArtifact,
			wantAPIVersion: CurrentPackageAPIVersion,
			wantArtifactID: digestArtifact,
			wantSourcePath: "forms/releases/" + releaseID + "/" + digestArtifact,
		},
	} {
		name, testCase := name, testCase
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var parsed PublicationLocator
			var err error
			if testCase.wantAPIVersion == CurrentPackageAPIVersion {
				parsed, err = ParsePublicationTagForPackageAPIVersion(testCase.tag, testCase.wantAPIVersion)
			} else {
				parsed, err = ParsePublicationTag(testCase.tag)
			}
			if err != nil {
				t.Fatal(err)
			}
			if parsed.APIVersion != testCase.wantAPIVersion || parsed.ReleaseID != releaseID ||
				parsed.ArtifactID != testCase.wantArtifactID || parsed.Tag != testCase.tag ||
				parsed.SourcePath != testCase.wantSourcePath {
				t.Fatalf("retained locator changed: %#v", parsed)
			}
			if _, _, family := FamilyReleaseID(parsed.ReleaseID); family {
				t.Fatal("a bare central Kind was read as a family locator")
			}
		})
	}
}

// TestParsePublicationTagRejectsACrossedLane keeps the two encodings from being
// mixed: a family release id has no retained SemVer artifact profile.
func TestParsePublicationTagRejectsACrossedLane(t *testing.T) {
	t.Parallel()
	tag := "forms/" + ReleaseIDForGroupKind(testFamilyGroup, "ObjectBucket") + "/v1.0.0"
	if _, err := ParsePublicationTag(tag); err == nil ||
		!strings.Contains(err.Error(), "Form Family release id with a retained SemVer artifact locator") {
		t.Fatalf("crossed-lane tag %q was accepted: %v", tag, err)
	}
}

// TestFamilyAndCentralReleaseLinesNeverCollide is the property the encoding
// exists for: the same Kind name in a family and in the frozen central epoch
// owns two different release lines, and two families own two more.
func TestFamilyAndCentralReleaseLinesNeverCollide(t *testing.T) {
	t.Parallel()
	central := ReleaseIDForKind("ObjectBucket")
	family := ReleaseIDForGroupKind(testFamilyGroup, "ObjectBucket")
	other := ReleaseIDForGroupKind("forms.example.com/v1alpha1", "ObjectBucket")
	for _, pair := range [][2]string{{central, family}, {central, other}, {family, other}} {
		if pair[0] == pair[1] {
			t.Fatalf("release lines collided: %q", pair[0])
		}
	}
}
