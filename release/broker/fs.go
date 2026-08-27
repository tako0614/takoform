package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

type fileIdentity struct {
	Path    string  `json:"path,omitempty"`
	SHA256  string  `json:"sha256,omitempty"`
	Dev     uint64  `json:"dev"`
	Ino     uint64  `json:"ino"`
	UID     uint32  `json:"uid"`
	GID     uint32  `json:"gid"`
	Mode    uint32  `json:"mode"`
	Nlink   uint64  `json:"nlink,omitempty"`
	Size    int64   `json:"size,omitempty"`
	MtimeMS float64 `json:"mtimeMs,omitempty"`
}

type stableFile struct {
	file     *os.File
	raw      []byte
	identity fileIdentity
}

func (file *stableFile) close() {
	if file != nil && file.file != nil {
		_ = file.file.Close()
	}
}

type stableFilePolicy struct {
	maximum       int64
	exactMode     uint32
	exactUID      uint32
	exactGID      uint32
	exactNlink    uint64
	allowAnyOwner bool
	allowEmpty    bool
}

func openStableRegularFile(path, label string, policy stableFilePolicy) (*stableFile, error) {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, fmt.Errorf("%s path is not one clean absolute path", label)
	}
	how := &unix.OpenHow{
		Flags:   uint64(unix.O_RDONLY | unix.O_CLOEXEC),
		Resolve: unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS,
	}
	fd, err := unix.Openat2(unix.AT_FDCWD, path, how)
	if err != nil {
		return nil, fmt.Errorf("open %s without symlinks: %w", label, err)
	}
	osFile := os.NewFile(uintptr(fd), label)
	success := false
	defer func() {
		if !success {
			_ = osFile.Close()
		}
	}()
	var before unix.Stat_t
	if err := unix.Fstat(fd, &before); err != nil {
		return nil, fmt.Errorf("stat %s: %w", label, err)
	}
	if before.Mode&unix.S_IFMT != unix.S_IFREG || before.Size < 0 || (!policy.allowEmpty && before.Size == 0) || before.Size > policy.maximum ||
		(!policy.allowAnyOwner && (before.Uid != policy.exactUID || before.Gid != policy.exactGID)) ||
		uint32(before.Mode&0o777) != policy.exactMode || uint64(before.Nlink) != policy.exactNlink {
		return nil, fmt.Errorf("%s is not one exact-custody regular file", label)
	}
	raw := make([]byte, before.Size)
	if _, err := io.ReadFull(io.NewSectionReader(osFile, 0, before.Size), raw); err != nil {
		return nil, fmt.Errorf("read %s: %w", label, err)
	}
	var after unix.Stat_t
	if err := unix.Fstat(fd, &after); err != nil {
		return nil, fmt.Errorf("restat %s: %w", label, err)
	}
	if !sameStatIdentity(before, after) {
		return nil, fmt.Errorf("%s changed while it was read", label)
	}
	identity := identityFromStat(path, before)
	identity.SHA256 = digestBytes(raw)
	success = true
	return &stableFile{file: osFile, raw: raw, identity: identity}, nil
}

// openRunningExecutable follows only the kernel-owned /proc/self/exe magic
// link, then applies the same stable byte/identity checks as a path open. It is
// used to prove the bytes currently executing, not merely the bytes currently
// installed at the broker pathname.
func openRunningExecutable(identityPath string, policy stableFilePolicy) (*stableFile, error) {
	fd, err := unix.Open("/proc/self/exe", unix.O_RDONLY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("open live broker executable: %w", err)
	}
	file := os.NewFile(uintptr(fd), "live-broker-executable")
	success := false
	defer func() {
		if !success {
			_ = file.Close()
		}
	}()
	var before unix.Stat_t
	if err := unix.Fstat(fd, &before); err != nil {
		return nil, fmt.Errorf("stat live broker executable: %w", err)
	}
	if before.Mode&unix.S_IFMT != unix.S_IFREG || before.Size <= 0 || before.Size > policy.maximum ||
		before.Uid != policy.exactUID || before.Gid != policy.exactGID || uint32(before.Mode&0o777) != policy.exactMode ||
		uint64(before.Nlink) != policy.exactNlink {
		return nil, errors.New("live broker executable is not one exact-custody regular file")
	}
	raw := make([]byte, before.Size)
	if _, err := io.ReadFull(io.NewSectionReader(file, 0, before.Size), raw); err != nil {
		return nil, fmt.Errorf("read live broker executable: %w", err)
	}
	var after unix.Stat_t
	if err := unix.Fstat(fd, &after); err != nil || !sameStatIdentity(before, after) {
		zeroBytes(raw)
		return nil, errors.New("live broker executable changed while it was read")
	}
	identity := identityFromStat(identityPath, before)
	identity.SHA256 = digestBytes(raw)
	success = true
	return &stableFile{file: file, raw: raw, identity: identity}, nil
}

func identityFromStat(path string, stat unix.Stat_t) fileIdentity {
	return fileIdentity{
		Path:    path,
		Dev:     uint64(stat.Dev),
		Ino:     stat.Ino,
		UID:     stat.Uid,
		GID:     stat.Gid,
		Mode:    uint32(stat.Mode & 0o777),
		Nlink:   uint64(stat.Nlink),
		Size:    stat.Size,
		MtimeMS: float64(stat.Mtim.Sec)*1000 + float64(stat.Mtim.Nsec)/1_000_000,
	}
}

func sameStatIdentity(left, right unix.Stat_t) bool {
	return left.Dev == right.Dev && left.Ino == right.Ino && left.Uid == right.Uid && left.Gid == right.Gid &&
		left.Mode == right.Mode && left.Nlink == right.Nlink && left.Size == right.Size &&
		left.Mtim.Sec == right.Mtim.Sec && left.Mtim.Nsec == right.Mtim.Nsec &&
		left.Ctim.Sec == right.Ctim.Sec && left.Ctim.Nsec == right.Ctim.Nsec
}

func requireIdentity(actual, expected fileIdentity, label string, includePath, includeDigest bool) error {
	if includePath && actual.Path != expected.Path {
		return fmt.Errorf("%s path changed", label)
	}
	if includeDigest && actual.SHA256 != expected.SHA256 {
		return fmt.Errorf("%s digest changed", label)
	}
	if actual.Dev != expected.Dev || actual.Ino != expected.Ino || actual.UID != expected.UID || actual.GID != expected.GID ||
		actual.Mode != expected.Mode || actual.Nlink != expected.Nlink || actual.Size != expected.Size || actual.MtimeMS != expected.MtimeMS {
		return fmt.Errorf("%s filesystem identity changed", label)
	}
	return nil
}

func openExactDirectory(path, label string, uid, gid, mode uint32) (*os.File, fileIdentity, error) {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, fileIdentity{}, fmt.Errorf("%s path is not one clean absolute path", label)
	}
	how := &unix.OpenHow{
		Flags:   uint64(unix.O_RDONLY | unix.O_DIRECTORY | unix.O_CLOEXEC),
		Resolve: unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS,
	}
	fd, err := unix.Openat2(unix.AT_FDCWD, path, how)
	if err != nil {
		return nil, fileIdentity{}, fmt.Errorf("open %s without symlinks: %w", label, err)
	}
	file := os.NewFile(uintptr(fd), label)
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		_ = file.Close()
		return nil, fileIdentity{}, fmt.Errorf("stat %s: %w", label, err)
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFDIR || stat.Uid != uid || stat.Gid != gid || uint32(stat.Mode&0o777) != mode {
		_ = file.Close()
		return nil, fileIdentity{}, fmt.Errorf("%s is not one exact-custody directory", label)
	}
	return file, identityFromStat(path, stat), nil
}

func readAllFDStable(fd int, label string, maximum int64, uid, gid, mode uint32, nlink uint64) ([]byte, fileIdentity, error) {
	var before unix.Stat_t
	if err := unix.Fstat(fd, &before); err != nil {
		return nil, fileIdentity{}, fmt.Errorf("stat %s: %w", label, err)
	}
	if before.Mode&unix.S_IFMT != unix.S_IFREG || before.Uid != uid || before.Gid != gid ||
		uint32(before.Mode&0o777) != mode || uint64(before.Nlink) != nlink || before.Size <= 0 || before.Size > maximum {
		return nil, fileIdentity{}, fmt.Errorf("%s is not one protected exact-mode regular FD", label)
	}
	raw := make([]byte, before.Size)
	read := 0
	for read < len(raw) {
		count, err := unix.Pread(fd, raw[read:], int64(read))
		if err != nil {
			return nil, fileIdentity{}, fmt.Errorf("read %s: %w", label, err)
		}
		if count == 0 {
			return nil, fileIdentity{}, fmt.Errorf("%s ended before its declared size", label)
		}
		read += count
	}
	var after unix.Stat_t
	if err := unix.Fstat(fd, &after); err != nil || !sameStatIdentity(before, after) {
		return nil, fileIdentity{}, fmt.Errorf("%s changed while it was read", label)
	}
	identity := identityFromStat("", before)
	identity.SHA256 = digestBytes(raw)
	return raw, identity, nil
}

func zeroBytes(raw []byte) {
	for index := range raw {
		raw[index] = 0
	}
}

func exactBytes(left, right []byte) bool {
	return bytes.Equal(left, right)
}

var errUnsupportedFilesystem = errors.New("filesystem does not support required race-safe operation")
