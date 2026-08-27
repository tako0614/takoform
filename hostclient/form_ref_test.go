package hostclient

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateFormRefAcceptsVersionlessExternalGroups(t *testing.T) {
	t.Parallel()
	for _, group := range []string{
		"queue.example.net",
		"api-1.publisher.example",
		"a.b",
	} {
		group := group
		t.Run(group, func(t *testing.T) {
			t.Parallel()
			ref := testRef
			ref.APIVersion = group
			if err := ValidateFormRef(ref); err != nil {
				t.Fatalf("versionless external FormRef %q rejected: %v", group, err)
			}
		})
	}
}

func TestValidateFormRefRejectsNonNeutralGroups(t *testing.T) {
	t.Parallel()
	for _, group := range []string{
		"queue.example.net/v1beta1",
		"queue.example.net/v1",
		"forms.takoform.com",
		"forms.takoform.com/v1",
		"forms.takoform.com/v1alpha1",
		"forms.takoform.com/v1alpha2",
		"packages.forms.takoform.com",
		"packages.forms.takoform.com/v1alpha5",
		"trust.forms.takoform.com",
		"trust.forms.takoform.com/v1alpha1",
	} {
		group := group
		t.Run(group, func(t *testing.T) {
			t.Parallel()
			ref := testRef
			ref.APIVersion = group
			if err := ValidateFormRef(ref); err == nil {
				t.Fatalf("non-neutral FormRef group %q was accepted", group)
			}
		})
	}
}

func TestValidateFormRefEnforcesTheStableGroupLength(t *testing.T) {
	t.Parallel()
	// Four valid DNS labels make a 253-character maximum. A 254-character
	// group is valid under the retained beta profile but not under form-ref-v1.
	valid := strings.Repeat("a", 63) + "." + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 61)
	ref := testRef
	ref.APIVersion = valid
	if err := ValidateFormRef(ref); err != nil {
		t.Fatalf("maximum-length neutral group rejected: %v", err)
	}
	ref.APIVersion += "d"
	if err := ValidateFormRef(ref); err == nil {
		t.Fatal("overlong neutral group was accepted")
	}
}

func TestOperationResultResourceRejectsNonNeutralFormRef(t *testing.T) {
	t.Parallel()
	ref := testRef
	ref.APIVersion = "queue.example.net/v1beta1"
	resource := wireResource("app", "uid-1", "1", "1", map[string]any{})
	resource["apiVersion"] = ref.APIVersion
	resource["form"].(map[string]any)["formRef"].(map[string]any)["apiVersion"] = ref.APIVersion
	result, err := json.Marshal(map[string]any{"resource": resource})
	if err != nil {
		t.Fatalf("marshal operation result: %v", err)
	}
	operation := &Operation{
		APIVersion: OperationAPIVersion,
		Kind:       OperationKind,
		ID:         "op_invalid_ref",
		Done:       true,
		Result:     result,
	}
	if _, err := OperationResultResource(operation, ref, "app", testSpace); err == nil {
		t.Fatal("operation result accepted a versioned FormRef")
	}
}
