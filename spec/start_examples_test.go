package spec

import (
	"encoding/json"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
)

var startHTTPFence = regexp.MustCompile("(?s)```http\\n(.*?)\\n```")

func TestStartHostAPIExamplesMatchFrozenSchemas(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("../website/start/index.md")
	if err != nil {
		t.Fatal(err)
	}
	putBlock := startHTTPBlock(t, string(raw), "PUT https://host.example/")
	operationBlock := startHTTPBlock(t, string(raw), "GET https://host.example/apis/forms.takoform.com/v1/operations/")
	put := startHTTPBody(t, putBlock)
	operation := startHTTPBody(t, operationBlock)

	const wireID = "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json"
	const operationID = "https://forms.takoform.com/schemas/operations/v1/operation.schema.json"
	applySchema := compileSchemaSet(t, []string{
		"schemas/form-ref-v1.schema.json",
		"schemas/host-api-wire-v1.schema.json",
	}, wireID+"#/$defs/applyRequest")
	if err := applySchema.Validate(put); err != nil {
		t.Fatalf("Start PUT body is not a frozen applyRequest: %v", err)
	}
	operationSchema := compileSchemaSet(t, []string{"schemas/operation-v1.schema.json"}, operationID)
	if err := operationSchema.Validate(operation); err != nil {
		t.Fatalf("Start Operation body is not a frozen Operation: %v", err)
	}
	resourceResponseSchema := compileSchemaSet(t, []string{
		"schemas/form-ref-v1.schema.json",
		"schemas/host-api-wire-v1.schema.json",
	}, wireID+"#/$defs/resourceResponse")
	result, ok := operation["result"].(map[string]any)
	if !ok {
		t.Fatal("Start Operation result is not an object")
	}
	resource, ok := result["resource"].(map[string]any)
	if !ok {
		t.Fatal("Start Operation result.resource is not an object")
	}
	if err := resourceResponseSchema.Validate(resource); err != nil {
		t.Fatalf("Start Operation result.resource is not a frozen resourceResponse: %v", err)
	}

	putURL := startHTTPURL(t, putBlock)
	if putURL.Host != "host.example" || putURL.Scheme != "https" {
		t.Fatalf("Start PUT URL has unexpected origin: %s", putURL)
	}
	if got, want := putURL.Path, "/apis/forms.takoform.com/v1/resources/resources.publisher.example/CounterReservation/counter-reservation"; got != want {
		t.Fatalf("Start PUT URL path = %q, want %q", got, want)
	}
	if !strings.Contains(putBlock, "If-None-Match: *") {
		t.Fatal("Start PUT example does not carry the create fence")
	}
	key := startHTTPHeader(putBlock, "Idempotency-Key")
	if key == "" || strings.ContainsAny(key, "<> \t\r\n") {
		t.Fatalf("Start PUT Idempotency-Key is not visible ASCII: %q", key)
	}

	operationURL := startHTTPURL(t, operationBlock)
	operationIDValue, ok := operation["id"].(string)
	if !ok || operationIDValue == "" {
		t.Fatal("Start Operation has no id")
	}
	if got := operationURL.Path[strings.LastIndex(operationURL.Path, "/")+1:]; got != operationIDValue {
		t.Fatalf("Start Operation URL id = %q, body id = %q", got, operationIDValue)
	}
	if _, exists := operation["response"]; exists {
		t.Fatal("Start Operation uses retired response field; terminal success is result")
	}
}

func startHTTPBlock(t *testing.T, source, marker string) string {
	t.Helper()
	for _, match := range startHTTPFence.FindAllStringSubmatch(source, -1) {
		if strings.Contains(match[1], marker) {
			return match[1]
		}
	}
	t.Fatalf("website/start/index.md has no http fence containing %q", marker)
	return ""
}

func startHTTPBody(t *testing.T, block string) map[string]any {
	t.Helper()
	start := strings.Index(block, "\n\n{")
	if start < 0 {
		t.Fatal("HTTP transcript has no JSON body")
	}
	var document map[string]any
	if err := json.NewDecoder(strings.NewReader(block[start+2:])).Decode(&document); err != nil {
		t.Fatalf("decode HTTP transcript JSON: %v", err)
	}
	return document
}

func startHTTPURL(t *testing.T, block string) *url.URL {
	t.Helper()
	line := strings.SplitN(block, "\n", 2)[0]
	fields := strings.Fields(line)
	if len(fields) != 2 {
		t.Fatalf("HTTP transcript request line = %q", line)
	}
	parsed, err := url.Parse(fields[1])
	if err != nil {
		t.Fatalf("parse HTTP transcript URL %q: %v", fields[1], err)
	}
	return parsed
}

func startHTTPHeader(block, name string) string {
	prefix := name + ":"
	for _, line := range strings.Split(block, "\n") {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return ""
}
