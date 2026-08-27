package formpackage

import (
	"strings"
	"testing"
)

func TestArbitraryReverseDNSFormRefsUseTheCurrentNeutralProfile(t *testing.T) {
	t.Parallel()
	for _, group := range []string{
		"resources.publisher.example",
		"queues.another-publisher.example",
	} {
		ref := map[string]any{
			"apiVersion":        group,
			"kind":              "ExampleStore",
			"definitionVersion": "0.1.0",
			"schemaDigest":      "sha256:" + strings.Repeat("a", 64),
		}
		if _, err := ValidateFormRef(canonicalMarshal(t, ref)); err != nil {
			t.Fatalf("current neutral FormRef for %s was rejected: %v", group, err)
		}
		ref["apiVersion"] = group + "/v1beta1"
		if _, err := ValidateFormRef(canonicalMarshal(t, ref)); err == nil {
			t.Fatalf("direct FormRef API inferred a retained profile for %s", group)
		}
	}
}
