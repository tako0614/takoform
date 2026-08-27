package formpackage

import (
	"encoding/json"
	"strings"
	"testing"
)

func bindingDefinitionFixture() map[string]any {
	return map[string]any{
		"apiVersion": "bindings.takoform.com/v1alpha2",
		"kind":       "BindingDefinition",
		"name":       "runtime-job.cache",
		"version":    "1.0.0",
		"title":      "Runtime job cache binding",
		"sourceRole": "revision",
		"targetInterface": map[string]any{
			"apiVersion":   "interfaces.takoform.com/v1alpha1",
			"name":         "cache.entries",
			"version":      "1.0.0",
			"schemaDigest": "sha256:" + strings.Repeat("a", 64),
		},
		"allowedTargetForms": []any{map[string]any{
			"apiVersion": "cache.publisher.example",
			"kind":       "CacheNamespace",
		}},
		"bindingNameGrammar": "^[A-Za-z_$][A-Za-z0-9_$]*$",
		"runtimeProjection": map[string]any{
			"operations": []any{"get", "put"},
		},
		"lifecycle": map[string]any{
			"targetDeletion": "refuse_while_bound",
		},
	}
}

func TestValidateBindingDefinitionUsesEmbeddedNormativeSchema(t *testing.T) {
	t.Parallel()
	fixture := bindingDefinitionFixture()
	raw := canonicalMarshal(t, fixture)
	if err := ValidateBindingDefinition(raw); err != nil {
		t.Fatalf("valid current Binding Definition was rejected: %v", err)
	}

	for _, test := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{
			name: "unknown field",
			mutate: func(value map[string]any) {
				value["unknown"] = true
			},
		},
		{
			name: "wrong exact target ref",
			mutate: func(value map[string]any) {
				target := value["targetInterface"].(map[string]any)
				target["apiVersion"] = "interfaces.takoform.com/v1alpha2"
			},
		},
		{
			name: "binding name grammar is not compilable",
			mutate: func(value map[string]any) {
				value["bindingNameGrammar"] = "^[$"
			},
		},
		{
			name: "binding name grammar is not anchored",
			mutate: func(value map[string]any) {
				value["bindingNameGrammar"] = "[A-Za-z_$][A-Za-z0-9_$]*"
			},
		},
		{
			name: "binding name grammar has no end anchor",
			mutate: func(value map[string]any) {
				value["bindingNameGrammar"] = "^[A-Za-z_$][A-Za-z0-9_$]*"
			},
		},
		{
			name: "binding name grammar escapes end anchor",
			mutate: func(value map[string]any) {
				value["bindingNameGrammar"] = `^[A-Za-z_$][A-Za-z0-9_$]*\$`
			},
		},
		{
			name: "one top-level alternative has no begin-text anchor",
			mutate: func(value map[string]any) {
				value["bindingNameGrammar"] = `^$|foo$`
			},
		},
		{
			name: "multiline mode weakens anchors to line boundaries",
			mutate: func(value map[string]any) {
				value["bindingNameGrammar"] = `^(?m)[A-Za-z_$][A-Za-z0-9_$]*$`
			},
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			candidate := bindingDefinitionFixture()
			test.mutate(candidate)
			encoded, err := json.Marshal(candidate)
			if err != nil {
				t.Fatal(err)
			}
			if err := ValidateBindingDefinition(encoded); err == nil || !strings.Contains(err.Error(), "Binding Definition") {
				t.Fatalf("invalid Binding Definition error = %v, want normative-schema rejection", err)
			}
		})
	}
}
