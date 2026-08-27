package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSSHSIGVerifiesPinnedKeyNamespaceAndReviewBytes(t *testing.T) {
	fixture := makeSignedReviewFixture(t, reviewNamespace)
	trust, err := parseReviewTrustRoot(fixture.publicKey, digestBytes(fixture.publicKey), fixture.fingerprint)
	if err != nil {
		t.Fatalf("generated trust root was rejected: %v", err)
	}
	if _, err := verifyReviewSSHSIG(fixture.signature, fixture.review, trust, reviewNamespace); err != nil {
		t.Fatalf("valid sshsig was rejected: %v", err)
	}
	changed := append([]byte{}, fixture.review...)
	changed[len(changed)-2] ^= 1
	if _, err := verifyReviewSSHSIG(fixture.signature, changed, trust, reviewNamespace); err == nil {
		t.Fatal("changed review bytes passed signature verification")
	}
	if _, err := verifyReviewSSHSIG(fixture.signature, fixture.review, trust, reviewNamespace+"-wrong"); err == nil {
		t.Fatal("wrong SSHSIG namespace was accepted")
	}

	other := makeSignedReviewFixture(t, reviewNamespace)
	if _, err := verifyReviewSSHSIG(other.signature, other.review, trust, reviewNamespace); err == nil {
		t.Fatal("signature from a different key was accepted")
	}
}

type signedReviewFixture struct {
	review      []byte
	signature   []byte
	publicKey   []byte
	fingerprint string
}

func makeSignedReviewFixture(t *testing.T, namespace string) signedReviewFixture {
	t.Helper()
	directory := t.TempDir()
	privateKey := filepath.Join(directory, "review-key")
	command := exec.Command("/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", privateKey)
	command.Env = []string{}
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("generate SSH fixture key: %v: %s", err, output)
	}
	review := []byte(`{"approved":true}` + "\n")
	reviewPath := filepath.Join(directory, "review.json")
	if err := os.WriteFile(reviewPath, review, 0o600); err != nil {
		t.Fatal(err)
	}
	command = exec.Command("/usr/bin/ssh-keygen", "-q", "-Y", "sign", "-f", privateKey, "-n", namespace, reviewPath)
	command.Env = []string{}
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("sign SSH fixture review: %v: %s", err, output)
	}
	publicKey, err := os.ReadFile(privateKey + ".pub")
	if err != nil {
		t.Fatal(err)
	}
	signature, err := os.ReadFile(reviewPath + ".sig")
	if err != nil {
		t.Fatal(err)
	}
	keyLine := strings.Fields(string(publicKey))
	blob, err := parseReviewTrustRoot(publicKey, digestBytes(publicKey), fingerprintForPublicKeyBlob(t, keyLine[1]))
	if err != nil {
		t.Fatalf("parse generated public key: %v", err)
	}
	return signedReviewFixture{review: review, signature: signature, publicKey: publicKey, fingerprint: blob.fingerprint}
}

func fingerprintForPublicKeyBlob(t *testing.T, encoded string) string {
	t.Helper()
	// Parse once without hard-coding a test fingerprint by asking ssh-keygen,
	// then compare it to the broker's independent computation above.
	directory := t.TempDir()
	path := filepath.Join(directory, "key.pub")
	if err := os.WriteFile(path, []byte("ssh-ed25519 "+encoded+" fixture\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("/usr/bin/ssh-keygen", "-lf", path, "-E", "sha256")
	command.Env = []string{}
	output, err := command.Output()
	if err != nil {
		t.Fatalf("fingerprint fixture public key: %v", err)
	}
	for _, field := range strings.Fields(string(output)) {
		if strings.HasPrefix(field, "SHA256:") {
			return field
		}
	}
	t.Fatal("ssh-keygen returned no SHA256 fingerprint")
	return ""
}
