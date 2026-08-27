package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"unicode/utf8"

	jsoncanonicalizer "github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

func parseCanonicalJSON(raw []byte, maximum int, label string, target any) ([]byte, error) {
	if len(raw) == 0 || len(raw) > maximum {
		return nil, fmt.Errorf("%s size is outside its closed bound", label)
	}
	if !utf8.Valid(raw) || raw[len(raw)-1] != '\n' || bytes.ContainsAny(raw[:len(raw)-1], "\r\n") {
		return nil, fmt.Errorf("%s must be UTF-8 canonical JSON plus one LF", label)
	}
	body := raw[:len(raw)-1]
	if err := rejectDuplicateJSONNames(body); err != nil {
		return nil, fmt.Errorf("%s is not closed JSON: %w", label, err)
	}
	canonical, err := jsoncanonicalizer.Transform(body)
	if err != nil {
		return nil, fmt.Errorf("%s cannot be canonicalized: %w", label, err)
	}
	if !bytes.Equal(canonical, body) {
		return nil, fmt.Errorf("%s is not exact canonical JSON", label)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return nil, fmt.Errorf("%s has an invalid closed shape: %w", label, err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return nil, fmt.Errorf("%s has trailing JSON: %w", label, err)
	}
	return canonical, nil
}

func canonicalJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return jsoncanonicalizer.Transform(raw)
}

func canonicalJSONLine(value any) ([]byte, error) {
	raw, err := canonicalJSON(value)
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func rejectDuplicateJSONNames(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := consumeJSONValue(decoder, 0); err != nil {
		return err
	}
	return requireJSONEOF(decoder)
}

func consumeJSONValue(decoder *json.Decoder, depth int) error {
	if depth > 256 {
		return errors.New("JSON nesting exceeds 256")
	}
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, composite := token.(json.Delim)
	if !composite {
		return nil
	}
	switch delim {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			nameToken, err := decoder.Token()
			if err != nil {
				return err
			}
			name, ok := nameToken.(string)
			if !ok {
				return errors.New("object name is not a string")
			}
			if _, duplicate := seen[name]; duplicate {
				return fmt.Errorf("duplicate object name %q", name)
			}
			seen[name] = struct{}{}
			if err := consumeJSONValue(decoder, depth+1); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim('}') {
			return errors.New("object is not closed")
		}
	case '[':
		for decoder.More() {
			if err := consumeJSONValue(decoder, depth+1); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim(']') {
			return errors.New("array is not closed")
		}
	default:
		return fmt.Errorf("unexpected JSON delimiter %q", delim)
	}
	return nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("more than one JSON value")
		}
		return err
	}
	return nil
}
