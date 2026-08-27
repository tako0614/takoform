package hostclient

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// getResourceResponseError serves one otherwise-valid resource response after
// mutate has made it protocol-invalid. Keeping this at the public read path
// makes each case prove that a response cannot enter caller state through the
// same route users exercise.
func getResourceResponseError(t *testing.T, mutate func(map[string]any)) error {
	t.Helper()
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.Method != http.MethodGet || r.URL.EscapedPath() != groupResourcePath("app", "") {
			return false
		}
		body := wireResource("app", "uid-1", "1", "7", map[string]any{"image": "example"})
		mutate(body)
		w.Header().Set("ETag", `"7"`)
		writeJSON(t, w, http.StatusOK, body)
		return true
	})
	_, err := client.GetResource(context.Background(), testSpace, testRef, "app")
	return err
}

func TestGetResourceRejectsProtocolInvalidResourceResponses(t *testing.T) {
	tooManyConditions := make([]map[string]any, 17)
	for index := range tooManyConditions {
		tooManyConditions[index] = map[string]any{
			"type":               "Ready",
			"status":             "True",
			"reason":             "Available",
			"lastTransitionTime": "2026-08-06T00:00:00Z",
		}
	}
	longHostReason := strings.Repeat("h", 257)
	longMessage := strings.Repeat("m", 4097)

	tests := []struct {
		name    string
		mutate  func(map[string]any)
		wantErr string
	}{
		{
			name: "invalid package digest",
			mutate: func(body map[string]any) {
				body["form"].(map[string]any)["packageDigest"] = "sha256:NOT-LOWERCASE"
			},
			wantErr: "packageDigest",
		},
		{
			name: "null package digest",
			mutate: func(body map[string]any) {
				body["form"].(map[string]any)["packageDigest"] = nil
			},
			wantErr: "packageDigest",
		},
		{
			name: "missing spec",
			mutate: func(body map[string]any) {
				delete(body, "spec")
			},
			wantErr: "spec",
		},
		{
			name: "null spec",
			mutate: func(body map[string]any) {
				body["spec"] = nil
			},
			wantErr: "spec",
		},
		{
			name: "null outputs",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["outputs"] = nil
			},
			wantErr: "outputs",
		},
		{
			name: "condition count exceeds schema maximum",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"] = tooManyConditions
			},
			wantErr: "conditions",
		},
		{
			name: "ready condition is required",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"] = []map[string]any{{
					"type":               "Reconciling",
					"status":             "Unknown",
					"reason":             "Provisioning",
					"lastTransitionTime": "2026-08-06T00:00:00Z",
				}}
			},
			wantErr: "Ready",
		},
		{
			name: "condition types are unique",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"] = []map[string]any{
					{
						"type":               "Ready",
						"status":             "True",
						"reason":             "Available",
						"lastTransitionTime": "2026-08-06T00:00:00Z",
					},
					{
						"type":               "Ready",
						"status":             "False",
						"reason":             "ExternalChange",
						"lastTransitionTime": "2026-08-06T00:00:00Z",
					},
				}
			},
			wantErr: "duplicate",
		},
		{
			name: "condition reason matrix is closed",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"] = []map[string]any{
					{
						"type":               "Ready",
						"status":             "True",
						"reason":             "Available",
						"lastTransitionTime": "2026-08-06T00:00:00Z",
					},
					{
						"type":               "Reconciling",
						"status":             "Unknown",
						"reason":             "ExternalChange",
						"lastTransitionTime": "2026-08-06T00:00:00Z",
					},
				}
			},
			wantErr: "reason",
		},
		{
			name: "condition timestamp uses date-time format",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"].([]map[string]any)[0]["lastTransitionTime"] = "not-a-time"
			},
			wantErr: "lastTransitionTime",
		},
		{
			name: "host reason is non-empty and bounded",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"].([]map[string]any)[0]["hostReason"] = longHostReason
			},
			wantErr: "hostReason",
		},
		{
			name: "empty host reason is invalid when present",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"].([]map[string]any)[0]["hostReason"] = ""
			},
			wantErr: "hostReason",
		},
		{
			name: "message is bounded",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"].([]map[string]any)[0]["message"] = longMessage
			},
			wantErr: "message",
		},
		{
			name: "null message is invalid when present",
			mutate: func(body map[string]any) {
				body["status"].(map[string]any)["conditions"].([]map[string]any)[0]["message"] = nil
			},
			wantErr: "message",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			err := getResourceResponseError(t, test.mutate)
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("protocol-invalid response was accepted, err = %v; want error containing %q", err, test.wantErr)
			}
		})
	}
}
