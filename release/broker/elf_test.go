package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestBrokerTestBinaryIsStaticLinuxAMD64WithOneGoBuildID(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := staticGoBuildID(raw)
	if err != nil {
		t.Fatalf("CGO-disabled broker test binary is not accepted: %v", err)
	}
	if !digestPattern.MatchString(digest) {
		t.Fatalf("noncanonical build-id digest %q", digest)
	}
}

func TestBrokerSelfIdentityUsesTheLiveProcExecutableBytes(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	information, err := os.Stat(executable)
	if err != nil {
		t.Fatal(err)
	}
	mode := uint32(information.Mode().Perm())
	installed, err := openStableRegularFile(executable, "test broker", stableFilePolicy{
		maximum: 256 * 1024 * 1024, exactMode: mode, exactUID: 0, exactGID: 0, exactNlink: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer installed.close()
	buildID, err := staticGoBuildID(installed.raw)
	if err != nil {
		t.Fatal(err)
	}
	expected := executableIdentity{
		Path: executable, SHA256: installed.identity.SHA256, Dev: installed.identity.Dev, Ino: installed.identity.Ino,
		UID: installed.identity.UID, GID: installed.identity.GID, Mode: installed.identity.Mode,
		Nlink: installed.identity.Nlink, Size: installed.identity.Size, MtimeMS: installed.identity.MtimeMS,
		StaticBuildID_SHA256: buildID,
	}
	actual, err := validateBrokerSelf(config{brokerPath: executable, brokerMode: mode}, expected)
	if err != nil {
		t.Fatalf("live broker identity was rejected: %v", err)
	}
	if actual.SHA256 != expected.SHA256 || actual.Dev != expected.Dev || actual.Ino != expected.Ino || actual.StaticBuildID_SHA256 != buildID {
		t.Fatalf("live broker identity differs: %#v", actual)
	}
}

func TestELFWithInterpreterIsRejected(t *testing.T) {
	raw := minimalELF(t, true)
	if _, err := staticGoBuildID(raw); err == nil {
		t.Fatal("ELF with PT_INTERP was accepted")
	}
}

func TestELFWithDynamicSegmentIsRejected(t *testing.T) {
	raw := minimalELF(t, true)
	binary.LittleEndian.PutUint32(raw[120:124], elfProgramDynamic)
	if _, err := staticGoBuildID(raw); err == nil {
		t.Fatal("ELF with PT_DYNAMIC was accepted")
	}
}

func minimalELF(t *testing.T, withInterpreter bool) []byte {
	t.Helper()
	note := make([]byte, 12+4+4)
	binary.LittleEndian.PutUint32(note[0:4], 4)
	binary.LittleEndian.PutUint32(note[4:8], 4)
	binary.LittleEndian.PutUint32(note[8:12], goBuildIDNote)
	copy(note[12:16], []byte{'G', 'o', 0, 0})
	copy(note[16:20], []byte("test"))
	count := 1
	if withInterpreter {
		count = 2
	}
	headerSize := 64 + count*56
	raw := make([]byte, headerSize+len(note))
	copy(raw[:4], []byte{0x7f, 'E', 'L', 'F'})
	raw[4], raw[5], raw[6] = elfClass64, elfDataLittle, 1
	binary.LittleEndian.PutUint16(raw[18:20], elfMachineAMD64)
	binary.LittleEndian.PutUint64(raw[32:40], 64)
	binary.LittleEndian.PutUint16(raw[54:56], 56)
	binary.LittleEndian.PutUint16(raw[56:58], uint16(count))
	program := raw[64 : 64+56]
	binary.LittleEndian.PutUint32(program[:4], elfProgramNote)
	binary.LittleEndian.PutUint64(program[8:16], uint64(headerSize))
	binary.LittleEndian.PutUint64(program[32:40], uint64(len(note)))
	if withInterpreter {
		binary.LittleEndian.PutUint32(raw[120:124], elfProgramInterp)
	}
	copy(raw[headerSize:], note)
	return raw
}
