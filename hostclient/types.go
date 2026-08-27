package hostclient

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tako0614/takoform/formpackage"
)

// FormRef pins one immutable typed Form Definition in a versionless reverse-DNS
// group (spec/schemas/form-ref-v1.schema.json). Publication and admission
// are external to this value.
type FormRef struct {
	APIVersion        string `json:"apiVersion"`
	Kind              string `json:"kind"`
	DefinitionVersion string `json:"definitionVersion"`
	SchemaDigest      string `json:"schemaDigest"`
}

// FormReference is the resource envelope's form block. PackageDigest is
// audit evidence recording the package the definition was installed from; it
// never enters resource identity, queries, or mutation fences.
type FormReference struct {
	FormRef       FormRef `json:"formRef"`
	PackageDigest string  `json:"packageDigest,omitempty"`
}

// Metadata is the API v1 resource metadata block. Name and Space are
// client-owned; UID, Generation, and Revision are host-owned identity
// (spec/decisions/0011) and required on every response.
type Metadata struct {
	Name       string `json:"name"`
	Space      string `json:"space"`
	UID        string `json:"uid,omitempty"`
	Generation string `json:"generation,omitempty"`
	Revision   string `json:"revision,omitempty"`
}

// Condition is one closed portable status condition.
type Condition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason"`
	HostReason         string `json:"hostReason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime"`
}

// Status carries the observed generation, the closed conditions, and the
// Form's output document. There is no observed document in this lane: the
// envelope owns status, and what a host observed reached a consumer through
// outputs already.
type Status struct {
	ObservedGeneration string         `json:"observedGeneration"`
	Conditions         []Condition    `json:"conditions"`
	Outputs            map[string]any `json:"outputs,omitempty"`
}

// Resource is the API v1 resource envelope. Spec is kept generic so the
// same transport carries every Service Form; the caller's resource layer owns
// the per-shape spec contents.
type Resource struct {
	APIVersion string         `json:"apiVersion"`
	Kind       string         `json:"kind"`
	Form       *FormReference `json:"form,omitempty"`
	Metadata   Metadata       `json:"metadata"`
	Spec       map[string]any `json:"spec,omitempty"`
	Status     *Status        `json:"status,omitempty"`
}

// Fence carries the optimistic-concurrency expectations of one apply. An
// empty ExpectedGeneration means create (If-None-Match: *); a non-empty one
// means update fenced by Takoform-Expected-Generation. ExpectedUID
// optionally pins the host-issued identity; mismatch fails uid_mismatch.
type Fence struct {
	ExpectedUID        string
	ExpectedGeneration string
}

// Diagnostic is one validate finding.
type Diagnostic struct {
	Severity string `json:"severity"`
	Field    string `json:"field,omitempty"`
	Message  string `json:"message"`
}

// ValidateResult reports validation diagnostics. Validation performs no
// mutation and issues no prepare digest.
type ValidateResult struct {
	Valid       bool         `json:"valid"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

// PrepareReview binds the exact spec, identity, and fences to a short-lived
// prepare digest; substitution after prepare fails invalid_argument before
// mutation.
type PrepareReview struct {
	PrepareDigest string `json:"prepareDigest"`
	SpecDigest    string `json:"specDigest"`
}

// PrepareResult echoes the prepared resource and its review fence.
type PrepareResult struct {
	Resource Resource      `json:"resource"`
	Review   PrepareReview `json:"review"`
}

var (
	resourceNamePattern = regexp.MustCompile(`^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`)
	uidPattern          = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	conditionTypes      = map[string]struct{}{
		"Ready": {}, "Reconciling": {}, "Degraded": {}, "Drifted": {}, "Blocked": {}, "Deleting": {},
	}
	conditionStatuses = map[string]struct{}{"True": {}, "False": {}, "Unknown": {}}
	conditionReasons  = map[string]map[string]struct{}{
		"Ready": {
			"Available":             {},
			"Provisioning":          {},
			"ExternalChange":        {},
			"DependencyMissing":     {},
			"UnsupportedCapability": {},
		},
		"Reconciling": {"Provisioning": {}},
		"Degraded":    {"ExternalChange": {}, "DependencyMissing": {}},
		"Drifted":     {"ExternalChange": {}},
		"Blocked":     {"UnsupportedCapability": {}, "DependencyMissing": {}},
		"Deleting":    {"Provisioning": {}},
	}
)

// ValidateFormRef enforces the stable v1 exact FormRef grammar. Stable v1
// accepts only a versionless reverse-DNS group; the Host API apex, any group
// containing a slash, and package/trust envelope namespaces are separate
// identities and fail closed. The structural fields then use
// formpackage's current-neutral validator so this client does not drift from
// the public Form Package contract.
func ValidateFormRef(ref FormRef) error {
	if utf8.RuneCountInString(ref.APIVersion) > 253 ||
		!formpackage.NamespacedFormGroup(ref.APIVersion) ||
		containsSlash(ref.APIVersion) {
		return errors.New("takoform: FormRef apiVersion must be a versionless reverse-DNS group")
	}
	raw, err := json.Marshal(ref)
	if err != nil {
		return fmt.Errorf("takoform: encoding FormRef: %w", err)
	}
	if _, err := formpackage.ValidateFormRef(raw); err != nil {
		return fmt.Errorf("takoform: invalid current-neutral FormRef: %w", err)
	}
	return nil
}

func containsSlash(value string) bool {
	for _, candidate := range value {
		if candidate == '/' {
			return true
		}
	}
	return false
}

// ValidateResourceName enforces the canonical portable name grammar.
// Resource names are stable wire identities, so callers must not trim,
// normalize, or case-fold them.
func ValidateResourceName(value string) error {
	if !resourceNamePattern.MatchString(value) {
		return errors.New("takoform: resource name must match ^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$")
	}
	return nil
}

// spaceIDMaxLength is measured in Unicode code points, matching JSON
// Schema's maxLength semantics for the normative host wire contract.
const spaceIDMaxLength = 255

// ValidateSpaceID enforces the portable Space identity contract without
// normalizing it: opaque, case-sensitive UTF-8; embedded whitespace is data;
// boundary whitespace (including U+FEFF), controls, and slash are forbidden.
func ValidateSpaceID(value string) error {
	if !utf8.ValidString(value) {
		return errors.New("SpaceID must be valid UTF-8")
	}
	length := utf8.RuneCountInString(value)
	if length < 1 || length > spaceIDMaxLength {
		return fmt.Errorf("SpaceID must contain between 1 and %d Unicode code points", spaceIDMaxLength)
	}
	first, _ := utf8.DecodeRuneInString(value)
	last, _ := utf8.DecodeLastRuneInString(value)
	if isSpaceIDBoundaryWhitespace(first) || isSpaceIDBoundaryWhitespace(last) {
		return errors.New("SpaceID must not start or end with whitespace")
	}
	for _, candidate := range value {
		switch {
		case candidate == '/':
			return errors.New("SpaceID must not contain '/'")
		case isSpaceIDControl(candidate):
			return errors.New("SpaceID must not contain control characters")
		}
	}
	return nil
}

// These explicit code-point sets mirror the normative JSON Schema. U+FEFF is
// treated as boundary whitespace even though modern Unicode removed it from
// White_Space; a BOM at an identity boundary is never useful.
func isSpaceIDBoundaryWhitespace(candidate rune) bool {
	switch {
	case candidate >= '\u0009' && candidate <= '\u000d':
		return true
	case candidate == '\u0020',
		candidate == '\u0085',
		candidate == '\u00a0',
		candidate == '\u1680',
		candidate >= '\u2000' && candidate <= '\u200a',
		candidate == '\u2028',
		candidate == '\u2029',
		candidate == '\u202f',
		candidate == '\u205f',
		candidate == '\u3000',
		candidate == '\ufeff':
		return true
	default:
		return false
	}
}

func isSpaceIDControl(candidate rune) bool {
	return candidate >= '\u0000' && candidate <= '\u001f' ||
		candidate >= '\u007f' && candidate <= '\u009f'
}

// validCanonicalDecimal reports whether value is a canonical positive
// decimal in 1..9223372036854775807, the shared generation/revision grammar.
func validCanonicalDecimal(value string) bool {
	if value == "" || value[0] == '0' {
		return false
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	return err == nil && parsed > 0
}

// sameFormRef reports whether two exact FormRefs carry the same contract
// identity. The packageDigest is excluded by design: it is distribution
// provenance, not contract identity, and a host that installed the same
// FormRef from a different legitimate package serves the same resources.
func sameFormRef(left, right FormRef) bool {
	return left.APIVersion == right.APIVersion &&
		left.Kind == right.Kind &&
		left.DefinitionVersion == right.DefinitionVersion &&
		left.SchemaDigest == right.SchemaDigest
}

// validateRequestResource fails closed before any wire traffic when the
// caller-supplied resource does not carry a coherent API v1 identity.
func validateRequestResource(resource *Resource) error {
	if resource == nil || resource.Form == nil {
		return errors.New("takoform: API v1 resource requires an exact FormRef")
	}
	if err := ValidateFormRef(resource.Form.FormRef); err != nil {
		return err
	}
	if resource.Form.PackageDigest != "" && !formpackage.ValidDigest(resource.Form.PackageDigest) {
		return errors.New("takoform: form.packageDigest must be a lowercase sha256:<hex> digest when present")
	}
	if resource.APIVersion != resource.Form.FormRef.APIVersion || resource.Kind != resource.Form.FormRef.Kind {
		return errors.New("takoform: resource apiVersion/kind and exact FormRef identities do not match")
	}
	if err := ValidateResourceName(resource.Metadata.Name); err != nil {
		return fmt.Errorf("takoform: resource metadata.name is invalid: %w", err)
	}
	if err := ValidateSpaceID(resource.Metadata.Space); err != nil {
		return fmt.Errorf("takoform: resource metadata.space has invalid SpaceID: %w", err)
	}
	return nil
}

// validateResourceResponseWire checks the closed JSON shape before typed
// decoding. DecodeStrictIJSON already rejects duplicate members, unknown
// typed fields, invalid UTF-8, non-I-JSON numbers, and trailing values, but
// encoding/json intentionally maps a JSON null optional string/object to its
// zero value. The wire schema distinguishes an omitted optional member from a
// present null, so this raw pass preserves that distinction and verifies the
// required object/array envelopes before semantic validation below.
func validateResourceResponseWire(data []byte, wrapped bool) error {
	var root map[string]json.RawMessage
	if err := decodeStrictJSON(data, &root); err != nil {
		return err
	}
	resourceRaw := root
	if wrapped {
		if err := resourceObjectKeys(root, []string{"resource"}, "resource"); err != nil {
			return fmt.Errorf("takoform: resource response envelope: %w", err)
		}
		var err error
		resourceRaw, err = rawObject(root["resource"], "resource response envelope resource")
		if err != nil {
			return err
		}
	}
	if err := validateResourceResponseObject(resourceRaw); err != nil {
		return err
	}
	return nil
}

func validatePrepareResponseWire(data []byte) error {
	var root map[string]json.RawMessage
	if err := decodeStrictJSON(data, &root); err != nil {
		return err
	}
	if err := resourceObjectKeys(root, []string{"resource", "review"}, "resource", "review"); err != nil {
		return fmt.Errorf("takoform: prepare response: %w", err)
	}
	resource, err := rawObject(root["resource"], "prepare response resource")
	if err != nil {
		return err
	}
	if err := validateResourceRequestObject(resource); err != nil {
		return err
	}
	review, err := rawObject(root["review"], "prepare response review")
	if err != nil {
		return err
	}
	if err := resourceObjectKeys(review, []string{"prepareDigest", "specDigest"}, "prepareDigest", "specDigest"); err != nil {
		return fmt.Errorf("takoform: prepare response review: %w", err)
	}
	for _, field := range []string{"prepareDigest", "specDigest"} {
		digest, err := rawStringValue(review[field])
		if err != nil || !formpackage.ValidDigest(digest) {
			return fmt.Errorf("takoform: prepare response review.%s must be a lowercase sha256:<hex> digest", field)
		}
	}
	return nil
}

func validateResourceResponseObject(resource map[string]json.RawMessage) error {
	return validateResourceObject(resource, true)
}

func validateResourceRequestObject(resource map[string]json.RawMessage) error {
	return validateResourceObject(resource, false)
}

func validateResourceObject(resource map[string]json.RawMessage, response bool) error {
	required := []string{"apiVersion", "kind", "form", "metadata", "spec"}
	allowed := []string{"apiVersion", "kind", "form", "metadata", "spec"}
	if response {
		required = append(required, "status")
		allowed = append(allowed, "status")
	}
	if err := resourceObjectKeys(resource, required, allowed...); err != nil {
		return fmt.Errorf("takoform: resource %s: %w", wireShapeName(response), err)
	}
	if err := requireRawString(resource, "apiVersion"); err != nil {
		return fmt.Errorf("takoform: resource %s apiVersion: %w", wireShapeName(response), err)
	}
	if err := requireRawString(resource, "kind"); err != nil {
		return fmt.Errorf("takoform: resource %s kind: %w", wireShapeName(response), err)
	}
	form, err := rawObject(resource["form"], "resource "+wireShapeName(response)+" form")
	if err != nil {
		return err
	}
	if err := resourceObjectKeys(form, []string{"formRef"}, "formRef", "packageDigest"); err != nil {
		return fmt.Errorf("takoform: resource %s form: %w", wireShapeName(response), err)
	}
	if _, err := rawObject(form["formRef"], "resource "+wireShapeName(response)+" form.formRef"); err != nil {
		return err
	}
	if packageDigest, present := form["packageDigest"]; present {
		digest, err := rawStringValue(packageDigest)
		if err != nil || !formpackage.ValidDigest(digest) {
			return fmt.Errorf("takoform: resource %s form.packageDigest must be a lowercase sha256:<hex> digest when present", wireShapeName(response))
		}
	}

	metadata, err := rawObject(resource["metadata"], "resource "+wireShapeName(response)+" metadata")
	if err != nil {
		return err
	}
	metadataRequired := []string{"name", "space"}
	if response {
		metadataRequired = append(metadataRequired, "uid", "generation", "revision")
	}
	if err := resourceObjectKeys(metadata, metadataRequired,
		"name", "space", "uid", "generation", "revision"); err != nil {
		return fmt.Errorf("takoform: resource %s metadata: %w", wireShapeName(response), err)
	}
	for _, field := range metadataRequired {
		if err := requireRawString(metadata, field); err != nil {
			return fmt.Errorf("takoform: resource %s metadata.%s: %w", wireShapeName(response), field, err)
		}
	}
	for _, field := range []string{"uid", "generation", "revision"} {
		if !containsString(metadataRequired, field) {
			if value, present := metadata[field]; present {
				if _, err := rawStringValue(value); err != nil {
					return fmt.Errorf("takoform: resource %s metadata.%s: %w", wireShapeName(response), field, err)
				}
			}
		}
	}
	if _, err := rawObject(resource["spec"], "resource "+wireShapeName(response)+" spec"); err != nil {
		return err
	}
	if !response {
		return nil
	}
	return validateResourceStatusObject(resource["status"])
}

func wireShapeName(response bool) string {
	if response {
		return "response"
	}
	return "request"
}

func validateResourceStatusObject(raw json.RawMessage) error {
	status, err := rawObject(raw, "resource response status")
	if err != nil {
		return err
	}
	if err := resourceObjectKeys(status, []string{"observedGeneration", "conditions"},
		"observedGeneration", "conditions", "outputs"); err != nil {
		return fmt.Errorf("takoform: resource response status: %w", err)
	}
	if err := requireRawString(status, "observedGeneration"); err != nil {
		return fmt.Errorf("takoform: resource response status.observedGeneration: %w", err)
	}
	conditions, err := rawArray(status["conditions"], "resource response status.conditions")
	if err != nil {
		return err
	}
	if len(conditions) > 16 {
		return errors.New("takoform: resource response status.conditions must contain at most 16 items")
	}
	for index, rawCondition := range conditions {
		condition, err := rawObject(rawCondition, fmt.Sprintf("resource response status.conditions[%d]", index))
		if err != nil {
			return err
		}
		if err := resourceObjectKeys(condition,
			[]string{"type", "status", "reason", "lastTransitionTime"},
			"type", "status", "reason", "hostReason", "message", "lastTransitionTime"); err != nil {
			return fmt.Errorf("takoform: resource response status.conditions[%d]: %w", index, err)
		}
		for _, field := range []string{"type", "status", "reason", "lastTransitionTime"} {
			if err := requireRawString(condition, field); err != nil {
				return fmt.Errorf("takoform: resource response status.conditions[%d].%s: %w", index, field, err)
			}
		}
		for _, field := range []string{"hostReason", "message"} {
			if value, present := condition[field]; present {
				text, err := rawStringValue(value)
				if err != nil {
					return fmt.Errorf("takoform: resource response status.conditions[%d].%s must be a string: %w", index, field, err)
				}
				if field == "hostReason" && text == "" {
					return fmt.Errorf("takoform: resource response status.conditions[%d].hostReason must be non-empty when present", index)
				}
				maxLength := 4096
				if field == "hostReason" {
					maxLength = 256
				}
				if utf8.RuneCountInString(text) > maxLength {
					return fmt.Errorf("takoform: resource response status.conditions[%d].%s exceeds %d Unicode code points", index, field, maxLength)
				}
			}
		}
	}
	if outputs, present := status["outputs"]; present {
		if _, err := rawObject(outputs, "resource response status.outputs"); err != nil {
			return err
		}
	}
	return nil
}

func resourceObjectKeys(value map[string]json.RawMessage, required []string, allowed ...string) error {
	want := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		want[key] = struct{}{}
	}
	for _, key := range required {
		if _, present := value[key]; !present {
			return fmt.Errorf("missing required field %q", key)
		}
	}
	for key := range value {
		if _, allowed := want[key]; !allowed {
			return fmt.Errorf("contains unknown field %q", key)
		}
	}
	return nil
}

func rawObject(raw json.RawMessage, field string) (map[string]json.RawMessage, error) {
	if !rawJSONObject(raw) {
		return nil, fmt.Errorf("takoform: %s must be an object", field)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, fmt.Errorf("takoform: %s: %w", field, err)
	}
	if object == nil {
		return nil, fmt.Errorf("takoform: %s must be an object", field)
	}
	return object, nil
}

func rawArray(raw json.RawMessage, field string) ([]json.RawMessage, error) {
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return nil, fmt.Errorf("takoform: %s must be an array", field)
	}
	var values []json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, fmt.Errorf("takoform: %s: %w", field, err)
	}
	if values == nil {
		return nil, fmt.Errorf("takoform: %s must be an array", field)
	}
	return values, nil
}

func requireRawString(object map[string]json.RawMessage, field string) error {
	value, present := object[field]
	if !present {
		return fmt.Errorf("missing required field %q", field)
	}
	if _, err := rawStringValue(value); err != nil {
		return fmt.Errorf("field %q must be a string: %w", field, err)
	}
	return nil
}

func rawStringValue(raw json.RawMessage) (string, error) {
	if strings.TrimSpace(string(raw)) == "null" {
		return "", errors.New("must be a string")
	}
	return rawString(raw)
}

// verifyResourceResponse enforces the response-side identity and semantic
// contract after the raw wire shape has been checked. The host may not change
// apiVersion, kind, name, space, or the exact FormRef (packageDigest excluded);
// uid/generation/revision must be present and canonical; status must carry a
// complete, bounded, uniquely-typed condition set with a valid reason matrix
// and RFC 3339 transition timestamps.
func verifyResourceResponse(ref FormRef, expectedName, expectedSpace string, got *Resource) error {
	if got == nil || got.Form == nil || !sameFormRef(ref, got.Form.FormRef) {
		return errors.New("takoform: host response changed the exact FormRef identity")
	}
	if got.Form.PackageDigest != "" && !formpackage.ValidDigest(got.Form.PackageDigest) {
		return errors.New("takoform: host response form.packageDigest must be a lowercase sha256:<hex> digest when present")
	}
	if got.APIVersion != ref.APIVersion || got.Kind != ref.Kind {
		return errors.New("takoform: host response changed the resource identity")
	}
	if got.Metadata.Name != expectedName || got.Metadata.Space != expectedSpace {
		return errors.New("takoform: host response changed the requested resource name or space")
	}
	if err := ValidateResourceName(got.Metadata.Name); err != nil {
		return fmt.Errorf("takoform: host response metadata.name is invalid: %w", err)
	}
	if err := ValidateSpaceID(got.Metadata.Space); err != nil {
		return fmt.Errorf("takoform: host response metadata.space is invalid: %w", err)
	}
	if !uidPattern.MatchString(got.Metadata.UID) {
		return errors.New("takoform: host response omitted a valid metadata.uid")
	}
	if !validCanonicalDecimal(got.Metadata.Generation) {
		return errors.New("takoform: host response omitted a canonical metadata.generation")
	}
	if !validCanonicalDecimal(got.Metadata.Revision) {
		return errors.New("takoform: host response omitted a canonical metadata.revision")
	}
	if got.Spec == nil {
		return errors.New("takoform: host response omitted an object-valued spec")
	}
	if got.Status == nil {
		return errors.New("takoform: host response omitted status")
	}
	if !validCanonicalDecimal(got.Status.ObservedGeneration) {
		return errors.New("takoform: host response omitted a canonical status.observedGeneration")
	}
	if got.Status.Conditions == nil {
		return errors.New("takoform: host response omitted status.conditions")
	}
	if len(got.Status.Conditions) > 16 {
		return errors.New("takoform: host response status.conditions must contain at most 16 items")
	}
	seenTypes := make(map[string]struct{}, len(got.Status.Conditions))
	ready := false
	for _, condition := range got.Status.Conditions {
		if _, known := conditionTypes[condition.Type]; !known {
			return fmt.Errorf("takoform: host response carries unknown condition type %q", condition.Type)
		}
		if _, duplicate := seenTypes[condition.Type]; duplicate {
			return fmt.Errorf("takoform: host response carries duplicate condition type %q", condition.Type)
		}
		seenTypes[condition.Type] = struct{}{}
		if _, known := conditionStatuses[condition.Status]; !known {
			return fmt.Errorf("takoform: host response carries unknown condition status %q", condition.Status)
		}
		if reasons := conditionReasons[condition.Type]; reasons == nil {
			return fmt.Errorf("takoform: host response carries no reason matrix for condition type %q", condition.Type)
		} else if _, allowed := reasons[condition.Reason]; !allowed {
			return fmt.Errorf("takoform: host response condition type %q cannot carry reason %q", condition.Type, condition.Reason)
		}
		if condition.Type == "Ready" {
			ready = true
		}
		if condition.HostReason != "" {
			if length := utf8.RuneCountInString(condition.HostReason); length > 256 {
				return errors.New("takoform: host response condition hostReason exceeds 256 Unicode code points")
			}
		}
		if length := utf8.RuneCountInString(condition.Message); length > 4096 {
			return errors.New("takoform: host response condition message exceeds 4096 Unicode code points")
		}
		if !validDateTime(condition.LastTransitionTime) {
			return errors.New("takoform: host response condition lastTransitionTime is not RFC 3339 date-time")
		}
	}
	if !ready {
		return errors.New("takoform: host response status.conditions must include Ready")
	}
	return nil
}

// validDateTime mirrors the JSON Schema date-time format used by the stable
// wire schema. In particular, that format accepts lower-case T/Z and the
// RFC 3339 leap second (23:59:60), which time.Parse(time.RFC3339, ...) rejects;
// it also bounds numeric offsets explicitly instead of accepting Go's looser
// +24:00/+23:60 forms.
func validDateTime(value string) bool {
	if len(value) < 20 || (value[10] != 'T' && value[10] != 't') {
		return false
	}
	if _, err := time.Parse("2006-01-02", value[:10]); err != nil {
		return false
	}
	timePart := value[11:]
	if len(timePart) < 9 || timePart[2] != ':' || timePart[5] != ':' {
		return false
	}
	parseTwoDigits := func(raw string) (int, bool) {
		if len(raw) != 2 || raw[0] < '0' || raw[0] > '9' || raw[1] < '0' || raw[1] > '9' {
			return 0, false
		}
		return int(raw[0]-'0')*10 + int(raw[1]-'0'), true
	}
	hour, ok := parseTwoDigits(timePart[0:2])
	if !ok {
		return false
	}
	minute, ok := parseTwoDigits(timePart[3:5])
	if !ok {
		return false
	}
	second, ok := parseTwoDigits(timePart[6:8])
	if !ok || hour > 23 || minute > 59 || second > 60 {
		return false
	}
	remainder := timePart[8:]
	if strings.HasPrefix(remainder, ".") {
		fraction := remainder[1:]
		digits := 0
		for digits < len(fraction) && fraction[digits] >= '0' && fraction[digits] <= '9' {
			digits++
		}
		if digits == 0 {
			return false
		}
		remainder = fraction[digits:]
	}
	if remainder == "Z" || remainder == "z" {
		return second < 60 || (hour == 23 && minute == 59)
	}
	if len(remainder) != 6 || (remainder[0] != '+' && remainder[0] != '-') || remainder[3] != ':' {
		return false
	}
	offsetHour, ok := parseTwoDigits(remainder[1:3])
	if !ok {
		return false
	}
	offsetMinute, ok := parseTwoDigits(remainder[4:6])
	if !ok || offsetHour > 23 || offsetMinute > 59 {
		return false
	}
	// Normalize the local clock to the offset's UTC side exactly as the
	// schema format validator does before deciding whether a leap second is
	// legal. The sign is inverted because '+' means local time is ahead of UTC.
	totalMinutes := hour*60 + minute
	if remainder[0] == '+' {
		totalMinutes -= offsetHour*60 + offsetMinute
	} else {
		totalMinutes += offsetHour*60 + offsetMinute
	}
	for totalMinutes < 0 {
		totalMinutes += 24 * 60
	}
	for totalMinutes >= 24*60 {
		totalMinutes -= 24 * 60
	}
	hour, minute = totalMinutes/60, totalMinutes%60
	return second < 60 || (hour == 23 && minute == 59)
}

// ResourceCondition returns the first condition of the given closed type, or
// nil when absent.
func ResourceCondition(resource *Resource, conditionType string) *Condition {
	if resource == nil || resource.Status == nil {
		return nil
	}
	for index := range resource.Status.Conditions {
		if resource.Status.Conditions[index].Type == conditionType {
			return &resource.Status.Conditions[index]
		}
	}
	return nil
}

// ResourceReady reports whether the Ready condition is present with status
// True.
func ResourceReady(resource *Resource) bool {
	condition := ResourceCondition(resource, "Ready")
	return condition != nil && condition.Status == "True"
}

func quoteRevision(revision string) string { return `"` + revision + `"` }

// requireRevisionETag enforces the strong-validator contract: exactly one
// ETag header whose value is the quoted metadata.revision.
func requireRevisionETag(headerValues []string, revision string) error {
	if len(headerValues) != 1 {
		return errors.New("takoform: host response must return exactly one ETag representation revision")
	}
	if headerValues[0] != quoteRevision(revision) {
		return errors.New("takoform: host response ETag does not match the representation revision")
	}
	return nil
}

// validWireDigest and digestCanonical delegate to formpackage's stable
// canonical-JSON helpers so the digest grammar has one implementation.
func validWireDigest(digest string) bool { return formpackage.ValidDigest(digest) }

func digestCanonical(raw []byte) (string, error) { return formpackage.DigestCanonicalJSON(raw) }
