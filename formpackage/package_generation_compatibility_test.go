package formpackage

import "testing"

func TestRevalidateDefinitionRequiresVerifierIssuedPackage(t *testing.T) {
	t.Parallel()
	if _, err := (VerifiedPackage{}).RevalidateDefinition(); err == nil {
		t.Fatal("zero package capability selected a schema profile")
	}
}

func TestVerifyDirectoryRetainsPackageGenerationsV1Alpha1ThroughV1Alpha5(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		build func(*testing.T) string
	}{
		{name: "v1alpha1", build: func(t *testing.T) string {
			return makeValidPackage(t, nil)
		}},
		{name: "v1alpha2", build: func(t *testing.T) string {
			root := makeValidPackage(t, nil)
			mutateIndex(t, root, func(index map[string]any) {
				index["apiVersion"] = LegacyContentAddressedPackageAPIVersion
				delete(index, "packageVersion")
			})
			return root
		}},
		{name: "v1alpha3", build: func(t *testing.T) string {
			root := makeValidPackage(t, nil)
			promotePackageToCurrentEpoch(t, root)
			return root
		}},
		{name: "v1alpha4", build: func(t *testing.T) string {
			return makeFamilyPackage(t, nil)
		}},
		{name: "v1alpha5", build: func(t *testing.T) string {
			return makeCurrentFamilyPackage(t, nil)
		}},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			report, err := VerifyDirectory(test.build(t))
			if err != nil {
				t.Fatalf("retained package generation failed verification: %v", err)
			}
			verified, ok := report.VerifiedPackage()
			if !ok || !verified.Valid() || verified.PackageDigest() != report.PackageDigest {
				t.Fatalf("verification did not issue the exact package capability: %#v, %v", verified, ok)
			}
			if _, err := verified.RevalidateDefinition(); err != nil {
				t.Fatalf("verified package did not retain its schema-generation profile: %v", err)
			}
		})
	}
}

func TestPackageGenerationProfileIsPublisherIndependent(t *testing.T) {
	t.Parallel()
	for _, group := range []string{
		"resources.publisher.example/v1beta1",
		"resources.another-publisher.example/v1beta1",
	} {
		group := group
		t.Run("retained "+group, func(t *testing.T) {
			t.Parallel()
			root := makeFamilyPackage(t, func(definition map[string]any) {
				definition["apiVersion"] = group
			})
			if _, err := VerifyDirectory(root); err != nil {
				t.Fatalf("v1alpha4 package profile depended on publisher group: %v", err)
			}
		})
	}
	for _, group := range []string{
		"resources.publisher.example",
		"resources.another-publisher.example",
	} {
		group := group
		t.Run("current "+group, func(t *testing.T) {
			t.Parallel()
			root := makeCurrentFamilyPackage(t, func(definition map[string]any) {
				definition["apiVersion"] = group
			})
			if _, err := VerifyDirectory(root); err != nil {
				t.Fatalf("v1alpha5 package profile depended on publisher group: %v", err)
			}
		})
	}
}
