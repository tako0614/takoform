package hostclient_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/tako0614/takoform/formpackage"
	"github.com/tako0614/takoform/hostclient"
)

// #region client
func ExampleClient_ApplyResource() {
	// A loopback HTTP fixture, not a real resource host. See the helper below.
	server, desired, calls := exampleHost()
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := hostclient.New(server.URL, "", nil)
	if _, err := client.Discover(ctx); err != nil {
		panic(err)
	}
	// An empty fence means create. ApplyResource checks exact availability,
	// prepares the request, then applies that review; it also polls a 202.
	resource, err := client.ApplyResource(ctx, desired, hostclient.Fence{})
	if err != nil {
		panic(err)
	}
	fmt.Println(resource.Metadata.Name, resource.Metadata.UID, hostclient.ResourceReady(resource))
	fmt.Println(strings.Join(*calls, " -> "))
	// Output:
	// greeting example-uid true
	// discovery -> availability -> prepare -> apply
}

// #endregion client

// exampleHost implements only a fixed synchronous-create exchange for this
// example. It has no credentials, durable data, admission or resource backend,
// and is not a conforming or deployable Host implementation.
func exampleHost() (*httptest.Server, *hostclient.Resource, *[]string) {
	ref := hostclient.FormRef{
		APIVersion: "resources.publisher.example", Kind: "GreetingPolicy",
		DefinitionVersion: "0.1.0", SchemaDigest: "sha256:" + strings.Repeat("a", 64),
	}
	desired := &hostclient.Resource{
		APIVersion: ref.APIVersion, Kind: ref.Kind,
		Form:     &hostclient.FormReference{FormRef: ref},
		Metadata: hostclient.Metadata{Name: "greeting", Space: "demo"},
		Spec:     map[string]any{"prefix": "Hello"},
	}
	calls := []string{}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		write := func(status int, value any) {
			w.WriteHeader(status)
			if err := json.NewEncoder(w).Encode(value); err != nil {
				panic(err)
			}
		}
		switch r.Method + " " + r.URL.Path {
		case "GET " + hostclient.DiscoveryPath:
			calls = append(calls, "discovery")
			features := map[string]bool{}
			for _, name := range []string{"service_forms", "exact_form_ref", "optimistic_concurrency", "idempotent_lifecycle", "operations", "artifact_upload", "support_profiles"} {
				features[name] = true
			}
			write(200, hostclient.Discovery{APIVersions: []string{hostclient.APIVersion}, Features: features, Endpoints: hostclient.Endpoints{API: server.URL + hostclient.APIRootPath}})
		case "GET " + hostclient.APIRootPath + "/forms":
			calls = append(calls, "availability")
			write(200, map[string]any{"forms": []map[string]any{{
				"identity": desired.Form, "definitionKnown": true, "installed": true,
				"executable": true, "activated": true, "availableToPrincipal": true,
				"operations": []string{"create"},
			}}})
		case "POST " + hostclient.APIRootPath + "/resources/prepare":
			calls = append(calls, "prepare")
			raw, _ := json.Marshal(desired.Spec)
			digest, err := formpackage.DigestCanonicalJSON(raw)
			if err != nil {
				panic(err)
			}
			write(200, hostclient.PrepareResult{Resource: *desired, Review: hostclient.PrepareReview{PrepareDigest: "sha256:" + strings.Repeat("b", 64), SpecDigest: digest}})
		case "PUT " + hostclient.APIRootPath + "/resources/resources.publisher.example/GreetingPolicy/greeting":
			calls = append(calls, "apply")
			var body struct {
				Review hostclient.PrepareReview `json:"review"`
			}
			if json.NewDecoder(r.Body).Decode(&body) != nil || body.Review.PrepareDigest != "sha256:"+strings.Repeat("b", 64) || r.Header.Get("If-None-Match") != "*" || r.Header.Get("Idempotency-Key") == "" {
				write(400, map[string]any{"error": "unexpected create request"})
				return
			}
			result := *desired
			result.Metadata.UID, result.Metadata.Generation, result.Metadata.Revision = "example-uid", "1", "1"
			result.Status = &hostclient.Status{ObservedGeneration: "1", Conditions: []hostclient.Condition{{Type: "Ready", Status: "True", Reason: "Available", LastTransitionTime: "2026-01-01T00:00:00Z"}}}
			w.Header().Set("ETag", `"1"`)
			write(201, result)
		default:
			write(404, map[string]any{"error": "not part of this example"})
		}
	}))
	return server, desired, &calls
}
