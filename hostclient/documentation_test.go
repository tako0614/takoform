package hostclient

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

// The website's conceptual HTTP exchange must remain valid client input. The
// paired-page site test separately keeps the Japanese and English bytes equal.
func TestDocumentationHTTPExchange(t *testing.T) {
	raw, err := os.ReadFile("../website/start/index.md")
	if err != nil {
		t.Fatal(err)
	}
	blocks := regexp.MustCompile("(?ms)^```http\\n(.*?)^```").FindAllSubmatch(raw, -1)
	if len(blocks) != 6 {
		t.Fatalf("want discovery, availability, prepare, apply, accepted and poll examples; got %d", len(blocks))
	}
	responses := make([][]byte, len(blocks))
	for i, block := range blocks {
		_, response, ok := strings.Cut(string(block[1]), "HTTP/1.1 ")
		if !ok {
			t.Fatalf("example %d has no response", i)
		}
		_, body, ok := strings.Cut(response, "\n\n")
		if !ok || !json.Valid([]byte(body)) {
			t.Fatalf("example %d has no complete JSON response", i)
		}
		responses[i] = []byte(body)
	}
	if err := validatePrepareResponseWire(responses[2]); err != nil {
		t.Fatal(err)
	}
	var prepared PrepareResult
	if err := json.Unmarshal(responses[2], &prepared); err != nil {
		t.Fatal(err)
	}
	if err := validatePrepareResult(&prepared.Resource, prepared.Resource.Spec, &prepared); err != nil {
		t.Fatal(err)
	}
	if err := validateResourceResponseWire(responses[3], false); err != nil {
		t.Fatal(err)
	}
	for i, wrapped := range map[int]bool{4: true, 5: false} {
		if err := validateOperationWire(responses[i], wrapped); err != nil {
			t.Fatal(err)
		}
	}
	var completed struct {
		Result struct {
			Resource json.RawMessage `json:"resource"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responses[5], &completed); err != nil {
		t.Fatal(err)
	}
	if err := validateResourceResponseWire(completed.Result.Resource, false); err != nil {
		t.Fatal(err)
	}
	if string(completed.Result.Resource) == "null" {
		t.Fatal("completion must carry the full resource")
	}
	for _, async := range []bool{false, true} {
		name := "synchronous"
		if async {
			name = "asynchronous"
		}
		t.Run(name, func(t *testing.T) {
			exchanges := []string{string(blocks[0][1]), string(blocks[1][1]), string(blocks[2][1]), string(blocks[3][1])}
			if async {
				request, _, _ := strings.Cut(exchanges[3], "HTTP/1.1 ")
				exchanges[3] = request + string(blocks[4][1])
				exchanges = append(exchanges, string(blocks[5][1]))
			}
			index := 0
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if index >= len(exchanges) {
					t.Errorf("unexpected additional request: %s %s", r.Method, r.URL)
					http.Error(w, "unexpected request", 500)
					return
				}
				text := exchanges[index]
				index++
				request, response, _ := strings.Cut(text, "HTTP/1.1 ")
				line, rest, _ := strings.Cut(request, "\n")
				method, address, _ := strings.Cut(line, " ")
				wantURL, err := url.Parse(address)
				if err != nil {
					t.Error(err)
					return
				}
				if r.Method != method || r.URL.Path != wantURL.Path || r.URL.Query().Encode() != wantURL.Query().Encode() {
					t.Errorf("got %s %s, want %s", r.Method, r.URL, line)
				}
				if method == "POST" || method == "PUT" {
					headers, body, _ := strings.Cut(rest, "\n\n")
					for _, header := range strings.Split(headers, "\n") {
						key, value, _ := strings.Cut(header, ": ")
						got := r.Header.Get(key)
						if key == "Idempotency-Key" {
							if got == "" {
								t.Error("missing idempotency key")
							}
						} else if got != value {
							t.Errorf("%s: got %q, want %q", key, got, value)
						}
					}
					var actual, expected any
					if err := json.NewDecoder(r.Body).Decode(&actual); err != nil {
						t.Error(err)
					}
					if err := json.Unmarshal([]byte(body), &expected); err != nil {
						t.Error(err)
					}
					if !reflect.DeepEqual(actual, expected) {
						t.Errorf("request differs from documented JSON: got %#v, want %#v", actual, expected)
					}
				}
				wire := strings.ReplaceAll("HTTP/1.1 "+response, "https://host.example", server.URL)
				res, err := http.ReadResponse(bufio.NewReader(strings.NewReader(wire)), nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer res.Body.Close()
				for key, values := range res.Header {
					w.Header()[key] = values
				}
				w.WriteHeader(res.StatusCode)
				if _, err := io.Copy(w, res.Body); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			client := New(server.URL, "", nil)
			if _, err := client.Discover(ctx); err != nil {
				t.Fatal(err)
			}
			result, err := client.ApplyResource(ctx, &prepared.Resource, Fence{})
			if err != nil {
				t.Fatal(err)
			}
			server.Close()
			if index != len(exchanges) || !ResourceReady(result) || result.Metadata.UID != "res_counter_reservation_1" {
				t.Fatalf("incomplete documented exchange: requests=%d, resource=%+v", index, result)
			}
		})
	}
}
