package formpackage_test

import (
	"encoding/json"
	"fmt"
	"testing/fstest"

	"github.com/tako0614/takoform/formpackage"
)

// This synthetic policy demonstrates authoring bytes, not a published Form
// or a Host implementation. It has no backend or runtime interface.
// #region definition
const exampleDefinition = `{
  "apiVersion": "resources.publisher.example",
  "kind": "GreetingPolicy",
  "definitionVersion": "0.1.0",
  "title": "Greeting policy authoring example",
  "description": "Synthetic authoring fixture. The prefix is stored exactly as supplied; updating replaces it and deleting removes the policy. No runtime endpoint is provided.",
  "role": "policy",
  "requiresHostApi": "forms.takoform.com/v1",
  "desiredSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "properties": {"prefix": {"type": "string", "minLength": 1, "maxLength": 40}},
    "required": ["prefix"]
  },
  "lifecycleCapabilities": ["create", "read", "update", "delete", "observe"]
}`

// #endregion definition

// ExampleVerifyFS builds and verifies a complete data-only package in memory.
// #region authoring
func ExampleVerifyFS() {
	raw := []byte(exampleDefinition)
	definition, err := formpackage.ValidateDefinition(raw)
	if err != nil {
		panic(err)
	}
	if err := formpackage.ValidateDesiredInstance(definition.DesiredSchema, map[string]any{"prefix": "Hello"}); err != nil {
		panic(err)
	}
	schemaDigest, err := formpackage.DigestCanonicalJSON(raw)
	if err != nil {
		panic(err)
	}
	index, err := json.Marshal(map[string]any{
		"apiVersion": formpackage.VersionlessFamilyPackageAPIVersion,
		"kind":       "FormPackage",
		"formRef": formpackage.FormRef{
			APIVersion: definition.APIVersion, Kind: definition.Kind,
			DefinitionVersion: definition.DefinitionVersion, SchemaDigest: schemaDigest,
		},
		"definitionPath": "definition.json",
		"files": []map[string]any{{
			"path": "definition.json", "mediaType": formpackage.DefinitionMediaType,
			"size": len(raw), "digest": formpackage.DigestBytes(raw),
		}},
	})
	if err != nil {
		panic(err)
	}
	files := fstest.MapFS{
		"definition.json":    &fstest.MapFile{Data: raw},
		"package-index.json": &fstest.MapFile{Data: index},
	}
	report, err := formpackage.VerifyFS(files, ".")
	if err != nil {
		panic(err)
	}
	fmt.Println(report.FormRef.Kind, report.FileCount)

	// A stale index must not validate a changed payload.
	files["definition.json"].Data = append(append([]byte{}, raw...), '\n')
	_, err = formpackage.VerifyFS(files, ".")
	fmt.Println("changed payload rejected:", err != nil)
	// Output:
	// GreetingPolicy 1
	// changed payload rejected: true
}

// #endregion authoring
