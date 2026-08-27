package formpackage

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func addContainerLikeFields(definition map[string]any) {
	desired := definition["desiredSchema"].(map[string]any)
	properties := desired["properties"].(map[string]any)
	stringList := func() map[string]any {
		return map[string]any{
			"type": "array", "maxItems": 64,
			"items": map[string]any{
				"type": "string", "pattern": `^[^\x00\r\n]{1,256}$`, "maxLength": 256,
			},
		}
	}
	properties["command"] = stringList()
	properties["args"] = stringList()
	properties["concurrencyTarget"] = map[string]any{
		"type": "integer", "minimum": 1, "maximum": 1000,
	}
	required, _ := desired["required"].([]any)
	desired["required"] = append(required, "concurrencyTarget")
}

func TestValidateDefinitionAcceptsBoundedContainerProcessConfiguration(t *testing.T) {
	t.Parallel()
	definition := currentFamilyDefinitionFixture(t)
	definition["requiresHostApi"] = "forms.takoform.com/v1"
	addContainerLikeFields(definition)
	if _, err := ValidateDefinition(canonicalMarshal(t, definition)); err != nil {
		t.Fatalf("bounded Container-like process configuration was rejected: %v", err)
	}
}

func reviewedInterfaceTargetSchema(group, kind string) map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []any{"apiVersion", "kind", "name"},
		"properties": map[string]any{
			"apiVersion": map[string]any{"type": "string", "const": group},
			"kind":       map[string]any{"type": "string", "const": kind},
			"name": map[string]any{
				"type": "string", "minLength": 1, "maxLength": 63,
				"pattern": `^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`,
			},
		},
		"x-takoform-required-interface": map[string]any{
			"apiVersion": "interfaces.takoform.com/v1alpha1",
			"name":       "queue.pull", "version": "1.0.0",
			"schemaDigest": "sha256:" + strings.Repeat("a", 64),
		},
	}
}

func reviewedTaggedTargetSchema() map[string]any {
	branch := func(tag, member, group, kind string) map[string]any {
		return map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"required":             []any{"type", member},
			"properties": map[string]any{
				"type": map[string]any{"type": "string", "const": tag},
				member: reviewedInterfaceTargetSchema(group, kind),
			},
		}
	}
	return map[string]any{
		"x-takoform-discriminator": "type",
		"oneOf": []any{
			branch("queueMessage", "queue", "queue.publisher.example", "PullQueue"),
			branch("topicPublish", "topic", "topic.publisher.example", "Topic"),
		},
	}
}

func TestValidateDefinitionAcceptsOnlySchemaProvenPortableTargetFields(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name   string
		target map[string]any
	}{
		{name: "direct canonical ResourceTarget", target: reviewedInterfaceTargetSchema("queue.publisher.example", "PullQueue")},
		{name: "closed tagged target union", target: reviewedTaggedTargetSchema()},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			definition := currentFamilyDefinitionFixture(t)
			definition["requiresHostApi"] = "forms.takoform.com/v1"
			desired := definition["desiredSchema"].(map[string]any)
			desired["properties"].(map[string]any)["target"] = test.target
			required, _ := desired["required"].([]any)
			desired["required"] = append(required, "target")
			if _, err := ValidateDefinition(canonicalMarshal(t, definition)); err != nil {
				t.Fatalf("schema-proven portable target was rejected: %v", err)
			}
		})
	}
}

func TestValidateDefinitionRejectsExecutableOrOpenCommandAndTargetFields(t *testing.T) {
	t.Parallel()
	openTarget := reviewedInterfaceTargetSchema("queue.publisher.example", "PullQueue")
	openTarget["additionalProperties"] = true
	unannotatedTarget := reviewedInterfaceTargetSchema("queue.publisher.example", "PullQueue")
	delete(unannotatedTarget, "x-takoform-required-interface")
	ambiguousTarget := reviewedInterfaceTargetSchema("queue.publisher.example", "PullQueue")
	ambiguousTarget["x-takoform-target-formrefs"] = []any{map[string]any{
		"apiVersion": "queue.publisher.example", "kind": "PullQueue", "definitionVersion": "0.1.0",
		"schemaDigest": "sha256:" + strings.Repeat("b", 64),
	}}
	partlyAnnotatedUnion := reviewedTaggedTargetSchema()
	secondBranch := partlyAnnotatedUnion["oneOf"].([]any)[1].(map[string]any)
	delete(secondBranch["properties"].(map[string]any)["topic"].(map[string]any), "x-takoform-required-interface")
	for _, test := range []struct {
		name  string
		field string
		shape map[string]any
	}{
		{name: "command string", field: "command", shape: map[string]any{"type": "string", "maxLength": 4096}},
		{name: "unbounded command list", field: "command", shape: map[string]any{
			"type": "array", "items": map[string]any{"type": "string", "pattern": ".+", "maxLength": 256},
		}},
		{name: "embedded script", field: "script", shape: map[string]any{"type": "string", "maxLength": 4096}},
		{name: "bare target", field: "target", shape: map[string]any{"type": "string", "maxLength": 128}},
		{name: "open object target", field: "target", shape: openTarget},
		{name: "unannotated ResourceTarget", field: "target", shape: unannotatedTarget},
		{name: "ambiguous target contract", field: "target", shape: ambiguousTarget},
		{name: "partly annotated tagged target", field: "target", shape: partlyAnnotatedUnion},
		{name: "backend target", field: "backendTarget", shape: reviewedInterfaceTargetSchema("queue.publisher.example", "PullQueue")},
		{name: "unbounded concurrency target", field: "concurrencyTarget", shape: map[string]any{"type": "integer", "minimum": 1}},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			definition := currentFamilyDefinitionFixture(t)
			definition["requiresHostApi"] = "forms.takoform.com/v1"
			properties := definition["desiredSchema"].(map[string]any)["properties"].(map[string]any)
			properties[test.field] = test.shape
			_, err := ValidateDefinition(canonicalMarshal(t, definition))
			if err == nil || !strings.Contains(err.Error(), "forbidden field") {
				t.Fatalf("ValidateDefinition error = %v, want forbidden field", err)
			}
		})
	}
}

func currentFamilyDefinitionFixture(t *testing.T) map[string]any {
	t.Helper()
	relation := func(kind string) map[string]any {
		return reviewedInterfaceTargetSchema("compute.publisher.example", kind)
	}
	return map[string]any{
		"apiVersion":        "compute.publisher.example",
		"kind":              "JobDeployment",
		"definitionVersion": "0.1.0",
		"title":             "Synthetic job deployment",
		"role":              "deployment",
		"requiresHostApi":   stableHostAPIVersion,
		"desiredSchema": map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"type":                 "object",
			"additionalProperties": false,
			"required":             []any{"className", "hostname", "otherWorker", "versions", "weights", "worker"},
			"properties": map[string]any{
				"className":   map[string]any{"type": "string", "minLength": 1, "maxLength": 64},
				"hostname":    map[string]any{"type": "string", "minLength": 1, "maxLength": 253},
				"worker":      relation("Job"),
				"otherWorker": relation("Job"),
				"weights": map[string]any{
					"type": "array", "minItems": 1, "maxItems": 8,
					"items": map[string]any{
						"type":                 "object",
						"additionalProperties": false,
						"required":             []any{"weight"},
						"properties": map[string]any{
							"weight": map[string]any{"type": "integer", "minimum": 1, "maximum": 10000},
						},
					},
				},
				"versions": map[string]any{
					"type": "array", "minItems": 1, "maxItems": 8,
					"items": map[string]any{
						"type":                 "object",
						"additionalProperties": false,
						"required":             []any{"workerVersion"},
						"properties": map[string]any{
							"workerVersion": relation("JobRevision"),
						},
					},
				},
			},
		},
		"outputSchema": map[string]any{
			"$schema":              "https://json-schema.org/draft/2020-12/schema",
			"type":                 "object",
			"additionalProperties": false,
			"required":             []any{"address"},
			"properties": map[string]any{
				"address": map[string]any{"type": "string", "minLength": 1, "maxLength": 256},
			},
		},
		"immutableFields":       []any{"/worker"},
		"lifecycleCapabilities": []any{"create", "read", "update", "delete", "import", "observe"},
	}
}

// TestValidateDefinitionUsesCurrentNeutralProfileForEveryPublisher proves the
// direct parser never infers compatibility from a publisher-owned group name.
func TestValidateDefinitionUsesCurrentNeutralProfileForEveryPublisher(t *testing.T) {
	t.Parallel()
	current := currentFamilyDefinitionFixture(t)
	current["constraints"] = []any{map[string]any{"kind": "acyclic", "reference": "/worker"}}
	raw := canonicalMarshal(t, current)
	decoded, err := ValidateDefinition(raw)
	if err != nil {
		t.Fatalf("versionless v1 Definition was refused by the runtime parser: %v", err)
	}
	if len(decoded.Constraints) != 1 || decoded.Constraints[0].Kind != "acyclic" || decoded.Constraints[0].Reference != "/worker" {
		t.Fatalf("decoded v1 constraint = %#v", decoded.Constraints)
	}

	for _, group := range []string{"compute.publisher.example", "service.another-publisher.example"} {
		candidate := make(map[string]any, len(current))
		for key, value := range current {
			candidate[key] = value
		}
		candidate["apiVersion"] = group
		if _, err := ValidateDefinition(canonicalMarshal(t, candidate)); err != nil {
			t.Fatalf("current neutral Definition for %s was rejected: %v", group, err)
		}
	}

	versioned := currentFamilyDefinitionFixture(t)
	versioned["apiVersion"] = "compute.publisher.example/v1beta1"
	if _, err := ValidateDefinition(canonicalMarshal(t, versioned)); err == nil {
		t.Fatal("direct API inferred a retained profile from a versioned publisher group")
	}

	preStableHost := currentFamilyDefinitionFixture(t)
	preStableHost["requiresHostApi"] = "forms.takoform.com/v1beta4"
	if _, err := ValidateDefinition(canonicalMarshal(t, preStableHost)); err == nil {
		t.Fatal("direct API silently selected a predecessor Definition profile")
	}
}

func TestEmbeddedV1SchemaPinsIdentityAndConstraintVocabulary(t *testing.T) {
	t.Parallel()
	raw, err := schemaFiles.ReadFile("schemas/form-definition-v1.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := DecodeStrictIJSON(raw, &document); err != nil {
		t.Fatal(err)
	}
	if got := document["$id"]; got != stableFamilyFormDefinitionSchemaID {
		t.Fatalf("embedded v1 $id = %v, want %s", got, stableFamilyFormDefinitionSchemaID)
	}
	properties := document["properties"].(map[string]any)
	constraints := properties["constraints"].(map[string]any)
	items := constraints["items"].(map[string]any)
	branches := items["oneOf"].([]any)
	got := map[string]bool{}
	for _, rawBranch := range branches {
		branch := rawBranch.(map[string]any)
		kindSchema := branch["properties"].(map[string]any)["kind"].(map[string]any)
		kind, ok := kindSchema["const"].(string)
		if !ok || kind == "" || got[kind] {
			t.Fatalf("embedded constraint branch has invalid/duplicate kind: %#v", kindSchema)
		}
		got[kind] = true
	}
	want := []string{
		"exclusive", "sum", "claim", "hostAssigned", "orderedPair", "uniqueBy",
		"acyclic", "distinctPair", "uniquePair", "sameResolvedTarget",
	}
	if len(got) != len(want) {
		t.Fatalf("embedded constraint kinds = %v, want %v", got, want)
	}
	for _, kind := range want {
		if !got[kind] {
			t.Fatalf("embedded v1 schema omits constraint kind %s", kind)
		}
	}
}

func TestZeroSumConstraintPreservesRequiredTotalMember(t *testing.T) {
	t.Parallel()
	base := currentFamilyDefinitionFixture(t)
	raw := canonicalMarshal(t, base)
	var definition FormDefinition
	if err := DecodeStrictIJSON(raw, &definition); err != nil {
		t.Fatal(err)
	}
	definition.Constraints = []FormConstraint{{Kind: "sum", List: "/versions", Member: "weight", Total: 0}}
	encoded, err := json.Marshal(definition)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"total":0`)) {
		t.Fatalf("zero sum lost its required total member: %s", encoded)
	}
	decoded, err := ValidateDefinition(encoded)
	if err != nil {
		t.Fatalf("valid zero sum was refused after typed encoding: %v", err)
	}
	if len(decoded.Constraints) != 1 || decoded.Constraints[0].Total != 0 {
		t.Fatalf("decoded zero sum = %#v", decoded.Constraints)
	}
}
