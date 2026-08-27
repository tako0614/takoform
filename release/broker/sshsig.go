package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
)

const sshSignatureMagic = "SSHSIG"

type reviewTrustRoot struct {
	publicKey   ed25519.PublicKey
	keyBlob     []byte
	fileSHA256  string
	blobSHA256  string
	fingerprint string
}

type verifiedSSHSIG struct {
	algorithm       string
	signatureSHA256 string
}

func parseReviewTrustRoot(raw []byte, expectedFileSHA256, expectedFingerprint string) (reviewTrustRoot, error) {
	if digestBytes(raw) != expectedFileSHA256 {
		return reviewTrustRoot{}, errors.New("review trust-root file digest differs from the pinned authority")
	}
	if bytes.ContainsAny(raw, "\r\x00") || len(raw) == 0 || raw[len(raw)-1] != '\n' {
		return reviewTrustRoot{}, errors.New("review trust root is not one LF-terminated OpenSSH public key")
	}
	line := strings.TrimSuffix(string(raw), "\n")
	fields := strings.Fields(line)
	if len(fields) < 2 || fields[0] != "ssh-ed25519" {
		return reviewTrustRoot{}, errors.New("review trust root is not one SSH Ed25519 public key")
	}
	blob, err := base64.StdEncoding.Strict().DecodeString(fields[1])
	if err != nil {
		return reviewTrustRoot{}, fmt.Errorf("review trust-root key blob is invalid: %w", err)
	}
	reader := sshWireReader{data: blob}
	algorithm, err := reader.readString()
	if err != nil || string(algorithm) != "ssh-ed25519" {
		return reviewTrustRoot{}, errors.New("review trust-root key algorithm is not exact ssh-ed25519")
	}
	key, err := reader.readString()
	if err != nil || len(key) != ed25519.PublicKeySize || !reader.empty() {
		return reviewTrustRoot{}, errors.New("review trust-root Ed25519 key payload is invalid")
	}
	fingerprintDigest := sha256.Sum256(blob)
	fingerprint := "SHA256:" + base64.RawStdEncoding.EncodeToString(fingerprintDigest[:])
	if fingerprint != expectedFingerprint {
		return reviewTrustRoot{}, errors.New("review trust-root fingerprint differs from the pinned authority")
	}
	return reviewTrustRoot{
		publicKey:   ed25519.PublicKey(bytes.Clone(key)),
		keyBlob:     bytes.Clone(blob),
		fileSHA256:  digestBytes(raw),
		blobSHA256:  digestBytes(blob),
		fingerprint: fingerprint,
	}, nil
}

func verifyReviewSSHSIG(signatureArmor, signedReview []byte, trust reviewTrustRoot, expectedNamespace string) (verifiedSSHSIG, error) {
	block, rest := pem.Decode(signatureArmor)
	if block == nil || block.Type != "SSH SIGNATURE" || len(block.Headers) != 0 || len(bytes.TrimSpace(rest)) != 0 {
		return verifiedSSHSIG{}, errors.New("review signature is not one closed armored SSHSIG")
	}
	if canonicalArmor := canonicalSSHSIGArmor(block.Bytes); !bytes.Equal(signatureArmor, canonicalArmor) {
		return verifiedSSHSIG{}, errors.New("review signature armor is not exact canonical SSHSIG PEM")
	}
	reader := sshWireReader{data: block.Bytes}
	if !reader.consumeLiteral(sshSignatureMagic) {
		return verifiedSSHSIG{}, errors.New("review signature SSHSIG magic differs")
	}
	version, err := reader.readUint32()
	if err != nil || version != 1 {
		return verifiedSSHSIG{}, errors.New("review signature SSHSIG version differs")
	}
	keyBlob, err := reader.readString()
	if err != nil || !bytes.Equal(keyBlob, trust.keyBlob) {
		return verifiedSSHSIG{}, errors.New("review signature was not made by the pinned key")
	}
	namespace, err := reader.readString()
	if err != nil || string(namespace) != expectedNamespace {
		return verifiedSSHSIG{}, errors.New("review signature namespace differs from the exact continuation namespace")
	}
	reserved, err := reader.readString()
	if err != nil || len(reserved) != 0 {
		return verifiedSSHSIG{}, errors.New("review signature SSHSIG reserved field must be empty")
	}
	hashAlgorithm, err := reader.readString()
	if err != nil || string(hashAlgorithm) != "sha512" {
		return verifiedSSHSIG{}, errors.New("review signature must use the exact SSHSIG sha512 hash")
	}
	signatureBlob, err := reader.readString()
	if err != nil || !reader.empty() {
		return verifiedSSHSIG{}, errors.New("review signature SSHSIG envelope is malformed")
	}
	signatureReader := sshWireReader{data: signatureBlob}
	signatureAlgorithm, err := signatureReader.readString()
	if err != nil || string(signatureAlgorithm) != "ssh-ed25519" {
		return verifiedSSHSIG{}, errors.New("review signature algorithm is not exact ssh-ed25519")
	}
	signature, err := signatureReader.readString()
	if err != nil || len(signature) != ed25519.SignatureSize || !signatureReader.empty() {
		return verifiedSSHSIG{}, errors.New("review Ed25519 signature payload is malformed")
	}
	reviewDigest := sha512.Sum512(signedReview)
	signedData := make([]byte, 0, 128)
	signedData = append(signedData, sshSignatureMagic...)
	signedData = appendSSHString(signedData, namespace)
	signedData = appendSSHString(signedData, reserved)
	signedData = appendSSHString(signedData, hashAlgorithm)
	signedData = appendSSHString(signedData, reviewDigest[:])
	if !ed25519.Verify(trust.publicKey, signedData, signature) {
		return verifiedSSHSIG{}, errors.New("review SSHSIG cryptographic verification failed")
	}
	return verifiedSSHSIG{
		algorithm:       "sshsig-ed25519-sha512",
		signatureSHA256: digestBytes(signatureArmor),
	}, nil
}

func canonicalSSHSIGArmor(raw []byte) []byte {
	encoded := base64.StdEncoding.EncodeToString(raw)
	result := []byte("-----BEGIN SSH SIGNATURE-----\n")
	for len(encoded) > 70 {
		result = append(result, encoded[:70]...)
		result = append(result, '\n')
		encoded = encoded[70:]
	}
	result = append(result, encoded...)
	result = append(result, []byte("\n-----END SSH SIGNATURE-----\n")...)
	return result
}

type sshWireReader struct {
	data   []byte
	offset int
}

func (reader *sshWireReader) consumeLiteral(literal string) bool {
	if len(reader.data)-reader.offset < len(literal) || string(reader.data[reader.offset:reader.offset+len(literal)]) != literal {
		return false
	}
	reader.offset += len(literal)
	return true
}

func (reader *sshWireReader) readUint32() (uint32, error) {
	if len(reader.data)-reader.offset < 4 {
		return 0, ioErrUnexpectedEOF
	}
	value := binary.BigEndian.Uint32(reader.data[reader.offset : reader.offset+4])
	reader.offset += 4
	return value, nil
}

func (reader *sshWireReader) readString() ([]byte, error) {
	length, err := reader.readUint32()
	if err != nil {
		return nil, err
	}
	if uint64(length) > uint64(len(reader.data)-reader.offset) {
		return nil, ioErrUnexpectedEOF
	}
	value := reader.data[reader.offset : reader.offset+int(length)]
	reader.offset += int(length)
	return value, nil
}

func (reader *sshWireReader) empty() bool {
	return reader.offset == len(reader.data)
}

func appendSSHString(target, value []byte) []byte {
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(value)))
	target = append(target, length[:]...)
	return append(target, value...)
}

var ioErrUnexpectedEOF = errors.New("unexpected end of SSH wire value")

func digestBytes(raw []byte) string {
	digest := sha256.Sum256(raw)
	return fmt.Sprintf("sha256:%x", digest[:])
}
