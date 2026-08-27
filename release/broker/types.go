package main

import "encoding/json"

type rootIdentity struct {
	Path string `json:"path"`
	Dev  uint64 `json:"dev"`
	Ino  uint64 `json:"ino"`
	UID  uint32 `json:"uid"`
	GID  uint32 `json:"gid"`
	Mode uint32 `json:"mode"`
}

type proposalFileIdentity struct {
	Dev     uint64  `json:"dev"`
	Ino     uint64  `json:"ino"`
	UID     uint32  `json:"uid"`
	GID     uint32  `json:"gid"`
	Mode    uint32  `json:"mode"`
	Nlink   uint64  `json:"nlink"`
	Size    int64   `json:"size"`
	MtimeMS float64 `json:"mtimeMs"`
}

type executableIdentity struct {
	Path                 string  `json:"path"`
	SHA256               string  `json:"sha256"`
	Dev                  uint64  `json:"dev"`
	Ino                  uint64  `json:"ino"`
	UID                  uint32  `json:"uid"`
	GID                  uint32  `json:"gid"`
	Mode                 uint32  `json:"mode"`
	Nlink                uint64  `json:"nlink"`
	Size                 int64   `json:"size"`
	MtimeMS              float64 `json:"mtimeMs"`
	StaticBuildID_SHA256 string  `json:"staticBuildIdSha256,omitempty"`
}

type inventoryRecord struct {
	Path    string  `json:"path"`
	Type    string  `json:"type"`
	Target  string  `json:"target,omitempty"`
	SHA256  string  `json:"sha256,omitempty"`
	Dev     uint64  `json:"dev"`
	Ino     uint64  `json:"ino"`
	UID     uint32  `json:"uid"`
	GID     uint32  `json:"gid"`
	Mode    uint32  `json:"mode"`
	Nlink   uint64  `json:"nlink"`
	Size    int64   `json:"size,omitempty"`
	MtimeMS float64 `json:"mtimeMs"`
}

func (record inventoryRecord) MarshalJSON() ([]byte, error) {
	base := map[string]any{
		"path": record.Path, "type": record.Type, "uid": record.UID,
		"gid": record.GID, "mode": record.Mode, "dev": record.Dev,
		"ino": record.Ino, "nlink": record.Nlink, "mtimeMs": record.MtimeMS,
	}
	switch record.Type {
	case "file":
		base["size"] = record.Size
		base["sha256"] = record.SHA256
	case "symlink":
		base["target"] = record.Target
	}
	return json.Marshal(base)
}

type boundFile struct {
	Path     string               `json:"path"`
	SHA256   string               `json:"sha256"`
	Identity proposalFileIdentity `json:"identity"`
}

type boundInput struct {
	Flag           string               `json:"flag"`
	Path           string               `json:"path"`
	Type           string               `json:"type"`
	SHA256         string               `json:"sha256,omitempty"`
	Identity       proposalFileIdentity `json:"identity,omitempty"`
	Inventory      []inventoryRecord    `json:"inventory,omitempty"`
	ManifestSHA256 string               `json:"manifestSha256,omitempty"`
	TreeSHA256     string               `json:"treeSha256,omitempty"`
}

type invocation struct {
	Surface string   `json:"surface"`
	Phase   string   `json:"phase"`
	Args    []string `json:"args"`
	SHA256  string   `json:"sha256"`
}

type credentialBinding struct {
	Class     string   `json:"class"`
	Names     []string `json:"names"`
	FD        int      `json:"fd"`
	Transport string   `json:"transport"`
}

type runtimeClosure struct {
	Node              executableIdentity `json:"node"`
	ContinuationTools struct {
		Git       executableIdentity `json:"git"`
		SSHKeygen executableIdentity `json:"sshKeygen"`
	} `json:"continuationTools"`
}

type preparationTools struct {
	Git executableIdentity  `json:"git"`
	Bun *executableIdentity `json:"bun,omitempty"`
}

type launcherBinding struct {
	Broker       executableIdentity `json:"broker"`
	ConfigSHA256 string             `json:"configSha256"`
	Runner       struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
	} `json:"runner"`
	StateRoot string `json:"stateRoot"`
}

type reviewBinding struct {
	Format                    string `json:"format"`
	Namespace                 string `json:"namespace"`
	TrustRootPath             string `json:"trustRootPath"`
	TrustRootRepositorySHA256 string `json:"trustRootRepositorySha256"`
	TrustRootBlobSHA256       string `json:"trustRootBlobSha256"`
	TrustRootFingerprint      string `json:"trustRootFingerprint"`
}

type sealedProposal struct {
	Format string       `json:"format"`
	Nonce  string       `json:"nonce"`
	Root   rootIdentity `json:"root"`
	Source struct {
		Commit              string            `json:"commit"`
		Root                string            `json:"root"`
		Inventory           []inventoryRecord `json:"inventory"`
		InventorySHA256     string            `json:"inventorySha256"`
		TreeSHA256          string            `json:"treeSha256"`
		RawSourceTreeSHA256 string            `json:"rawSourceTreeSha256"`
		ReviewRecord        boundFile         `json:"reviewRecord"`
	} `json:"source"`
	Inputs           []boundInput      `json:"inputs"`
	Invocation       invocation        `json:"invocation"`
	Credential       credentialBinding `json:"credential"`
	Runtime          runtimeClosure    `json:"runtime"`
	PreparationTools preparationTools  `json:"preparationTools"`
	Launcher         launcherBinding   `json:"launcher"`
	Review           reviewBinding     `json:"review"`
	IdentityEvidence map[string]any    `json:"identityEvidence"`
}

type signedReview struct {
	Approved              bool           `json:"approved"`
	BoundIdentityEvidence map[string]any `json:"boundIdentityEvidence"`
	Format                string         `json:"format"`
	Invocation            invocation     `json:"invocation"`
	ProposalSHA256        string         `json:"proposalSha256"`
	ReviewNamespace       string         `json:"reviewNamespace"`
	ReviewedAt            string         `json:"reviewedAt"`
	Reviewer              string         `json:"reviewer"`
	SourceBinding         sourceBinding  `json:"sourceBinding"`
	TrustRootFingerprint  string         `json:"trustRootFingerprint"`
}

type sourceBinding struct {
	Commit                string `json:"commit"`
	RawSourceTreeSHA256   string `json:"rawSourceTreeSha256"`
	SourceReviewSHA256    string `json:"sourceReviewSha256"`
	ClosureManifestSHA256 string `json:"closureManifestSha256"`
	ClosureTreeSHA256     string `json:"closureTreeSha256"`
}

type sourceReview struct {
	Approved            bool     `json:"approved"`
	BrokerSHA256        string   `json:"brokerSha256"`
	Format              string   `json:"format"`
	RawSourceTreeSHA256 string   `json:"rawSourceTreeSha256"`
	Reviewed            []string `json:"reviewed"`
	ReviewedAt          string   `json:"reviewedAt"`
	Reviewer            string   `json:"reviewer"`
	Source              string   `json:"source"`
}

type internalCapability struct {
	Format                   string            `json:"format"`
	ProposalSHA256           string            `json:"proposalSha256"`
	SignedReviewSHA256       string            `json:"signedReviewSha256"`
	Source                   runSource         `json:"source"`
	Invocation               invocation        `json:"invocation"`
	ReviewedInvocationSHA256 string            `json:"reviewedInvocationSha256"`
	ExecutionMappingSHA256   string            `json:"executionMappingSha256"`
	Credential               runCredential     `json:"credential"`
	Broker                   runBrokerIdentity `json:"broker"`
	Runtime                  runRuntime        `json:"runtime"`
	EphemeralRoot            string            `json:"ephemeralRoot"`
	IdentityEvidence         map[string]any    `json:"identityEvidence"`
	AuthenticityEvidence     map[string]any    `json:"authenticityEvidence"`
	Nonce                    string            `json:"nonce"`
}

type runSource struct {
	Commit string `json:"commit"`
	Root   string `json:"root"`
}

type runCredential struct {
	Class string   `json:"class"`
	Names []string `json:"names"`
}

type runBrokerIdentity struct {
	Path                   string `json:"path"`
	SHA256                 string `json:"sha256"`
	Dev                    uint64 `json:"dev"`
	Ino                    uint64 `json:"ino"`
	UID                    uint32 `json:"uid"`
	GID                    uint32 `json:"gid"`
	Mode                   uint32 `json:"mode"`
	StaticBuildID_SHA256   string `json:"staticBuildIdSha256"`
	IdentityEnvelopeSHA256 string `json:"identityEnvelopeSha256"`
}

type runRuntime struct {
	Node runExecutableIdentity `json:"node"`
}

type runExecutableIdentity struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Dev    uint64 `json:"dev"`
	Ino    uint64 `json:"ino"`
	UID    uint32 `json:"uid"`
	GID    uint32 `json:"gid"`
	Mode   uint32 `json:"mode"`
}

type runRequest struct {
	Format                 string            `json:"format"`
	ProposalEnvelopeSHA256 string            `json:"proposalEnvelopeSha256"`
	ReviewRecordSHA256     string            `json:"reviewRecordSha256"`
	Source                 runSource         `json:"source"`
	Invocation             invocation        `json:"invocation"`
	Credential             runCredential     `json:"credential"`
	Broker                 runBrokerIdentity `json:"broker"`
	Runtime                runRuntime        `json:"runtime"`
	EphemeralRoot          string            `json:"ephemeralRoot"`
	IdentityEvidence       map[string]any    `json:"identityEvidence"`
	Attestation            struct {
		SignedReviewEnvelopeSHA256    string `json:"signedReviewEnvelopeSha256"`
		CapabilityEnvelopeSHA256      string `json:"capabilityEnvelopeSha256"`
		CapabilityConsumeMarkerSHA256 string `json:"capabilityConsumeMarkerSha256"`
	} `json:"attestation"`
}

type consumeMarker struct {
	Format                    string `json:"format"`
	ProposalSHA256            string `json:"proposalSha256"`
	SignedReviewSHA256        string `json:"signedReviewSha256"`
	NonceSHA256               string `json:"nonceSha256"`
	CapabilityEnvelopeSHA256  string `json:"capabilityEnvelopeSha256"`
	BrokerIdentitySHA256      string `json:"brokerIdentitySha256"`
	ReviewedInvocationSHA256  string `json:"reviewedInvocationSha256"`
	ExecutionInvocationSHA256 string `json:"executionInvocationSha256"`
	ExecutionMappingSHA256    string `json:"executionMappingSha256"`
}
