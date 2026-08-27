package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

const (
	maximumClosureFileBytes  = 64 * 1024 * 1024
	maximumClosureTotalBytes = 2 * 1024 * 1024 * 1024
	maximumClosureRecords    = 1_000_000
)

type closureWalk struct {
	rootFD       int
	records      []inventoryRecord
	totalBytes   int64
	exactUID     uint32
	exactGID     uint32
	enforceOwner bool
}

func inspectClosure(rootPath, label string, exactUID, exactGID uint32) ([]inventoryRecord, error) {
	how := &unix.OpenHow{
		Flags:   uint64(unix.O_RDONLY | unix.O_DIRECTORY | unix.O_CLOEXEC),
		Resolve: unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS,
	}
	rootFD, err := unix.Openat2(unix.AT_FDCWD, rootPath, how)
	if err != nil {
		return nil, fmt.Errorf("open %s root without symlinks: %w", label, err)
	}
	defer unix.Close(rootFD)
	var rootStat unix.Stat_t
	if err := unix.Fstat(rootFD, &rootStat); err != nil {
		return nil, fmt.Errorf("stat %s root: %w", label, err)
	}
	if rootStat.Mode&unix.S_IFMT != unix.S_IFDIR || rootStat.Uid != exactUID || rootStat.Gid != exactGID || uint32(rootStat.Mode&0o777) != 0o555 {
		return nil, fmt.Errorf("%s root is not exact owner mode 0555", label)
	}
	walk := &closureWalk{rootFD: rootFD, exactUID: exactUID, exactGID: exactGID, enforceOwner: true}
	if err := walk.directory(rootFD, ""); err != nil {
		return nil, err
	}
	return walk.records, nil
}

func inspectReviewedClosure(rootPath, label string) ([]inventoryRecord, error) {
	how := &unix.OpenHow{
		Flags:   uint64(unix.O_RDONLY | unix.O_DIRECTORY | unix.O_CLOEXEC),
		Resolve: unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS,
	}
	rootFD, err := unix.Openat2(unix.AT_FDCWD, rootPath, how)
	if err != nil {
		return nil, fmt.Errorf("open %s root without symlinks: %w", label, err)
	}
	defer unix.Close(rootFD)
	var rootStat unix.Stat_t
	if err := unix.Fstat(rootFD, &rootStat); err != nil {
		return nil, fmt.Errorf("stat %s root: %w", label, err)
	}
	if rootStat.Mode&unix.S_IFMT != unix.S_IFDIR || uint32(rootStat.Mode&0o777) != 0o555 {
		return nil, fmt.Errorf("%s root is not exact mode 0555", label)
	}
	walk := &closureWalk{rootFD: rootFD}
	if err := walk.directory(rootFD, ""); err != nil {
		return nil, err
	}
	return walk.records, nil
}

func (walk *closureWalk) directory(directoryFD int, relativeRoot string) error {
	duplicate, err := unix.Dup(directoryFD)
	if err != nil {
		return fmt.Errorf("duplicate sealed directory FD: %w", err)
	}
	directory := os.NewFile(uintptr(duplicate), "sealed-directory")
	names, readErr := directory.Readdirnames(-1)
	closeErr := directory.Close()
	if readErr != nil {
		return fmt.Errorf("read sealed directory: %w", readErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close sealed directory: %w", closeErr)
	}
	sort.Strings(names)
	for _, name := range names {
		if name == "" || name == "." || name == ".." || !utf8.ValidString(name) || strings.ContainsRune(name, '/') || strings.ContainsRune(name, 0) {
			return errors.New("sealed directory contains an invalid entry name")
		}
		relativePath := name
		if relativeRoot != "" {
			relativePath = relativeRoot + "/" + name
		}
		if len(walk.records) >= maximumClosureRecords {
			return errors.New("sealed closure exceeds its record bound")
		}
		var before unix.Stat_t
		if err := unix.Fstatat(directoryFD, name, &before, unix.AT_SYMLINK_NOFOLLOW); err != nil {
			return fmt.Errorf("stat sealed closure %s: %w", relativePath, err)
		}
		if walk.enforceOwner && (before.Uid != walk.exactUID || before.Gid != walk.exactGID) {
			return fmt.Errorf("sealed closure %s has foreign ownership", relativePath)
		}
		record := inventoryRecord{
			Path: relativePath, Dev: uint64(before.Dev), Ino: before.Ino,
			UID: before.Uid, GID: before.Gid, Mode: uint32(before.Mode & 0o777),
			Nlink: uint64(before.Nlink), MtimeMS: float64(before.Mtim.Sec)*1000 + float64(before.Mtim.Nsec)/1_000_000,
		}
		switch before.Mode & unix.S_IFMT {
		case unix.S_IFDIR:
			if record.Mode != 0o555 {
				return fmt.Errorf("sealed closure directory %s is not exact mode 0555", relativePath)
			}
			record.Type = "directory"
			walk.records = append(walk.records, record)
			childFD, err := unix.Openat(directoryFD, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
			if err != nil {
				return fmt.Errorf("open sealed directory %s: %w", relativePath, err)
			}
			var opened unix.Stat_t
			if err := unix.Fstat(childFD, &opened); err != nil || !sameStatIdentity(before, opened) {
				unix.Close(childFD)
				return fmt.Errorf("sealed directory %s changed while opened", relativePath)
			}
			err = walk.directory(childFD, relativePath)
			unix.Close(childFD)
			if err != nil {
				return err
			}
		case unix.S_IFREG:
			if record.Nlink != 1 || (record.Mode != 0o444 && record.Mode != 0o555) || before.Size < 0 || before.Size > maximumClosureFileBytes {
				return fmt.Errorf("sealed closure file %s is not an exact ordinary file", relativePath)
			}
			if walk.totalBytes > maximumClosureTotalBytes-before.Size {
				return errors.New("sealed closure exceeds its total byte bound")
			}
			walk.totalBytes += before.Size
			fd, err := unix.Openat(directoryFD, name, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
			if err != nil {
				return fmt.Errorf("open sealed file %s: %w", relativePath, err)
			}
			file := os.NewFile(uintptr(fd), relativePath)
			raw := make([]byte, before.Size)
			_, readErr := io.ReadFull(io.NewSectionReader(file, 0, before.Size), raw)
			var after unix.Stat_t
			statErr := unix.Fstat(fd, &after)
			closeErr := file.Close()
			if readErr != nil || statErr != nil || closeErr != nil || !sameStatIdentity(before, after) {
				return fmt.Errorf("sealed file %s changed while read", relativePath)
			}
			record.Type = "file"
			record.Size = before.Size
			record.SHA256 = digestBytes(raw)
			walk.records = append(walk.records, record)
		case unix.S_IFLNK:
			if record.Nlink != 1 || record.Mode != 0o777 {
				return fmt.Errorf("sealed symlink %s has an invalid identity", relativePath)
			}
			target, err := readlinkAt(directoryFD, name)
			if err != nil || target == "" || strings.ContainsRune(target, 0) {
				return fmt.Errorf("read sealed symlink %s: %w", relativePath, err)
			}
			if filepath.IsAbs(target) {
				return fmt.Errorf("sealed symlink %s is absolute", relativePath)
			}
			resolvedRelative := filepath.Clean(filepath.Join(filepath.Dir(relativePath), target))
			if resolvedRelative == ".." || strings.HasPrefix(resolvedRelative, "../") || filepath.IsAbs(resolvedRelative) {
				return fmt.Errorf("sealed symlink %s escapes its closure", relativePath)
			}
			resolvedFD, err := unix.Openat2(walk.rootFD, relativePath, &unix.OpenHow{
				Flags:   uint64(unix.O_PATH | unix.O_CLOEXEC),
				Resolve: unix.RESOLVE_BENEATH | unix.RESOLVE_NO_MAGICLINKS,
			})
			if err != nil {
				return fmt.Errorf("sealed symlink %s is broken or escaping: %w", relativePath, err)
			}
			unix.Close(resolvedFD)
			record.Type = "symlink"
			record.Target = target
			walk.records = append(walk.records, record)
		default:
			return fmt.Errorf("sealed closure %s is not a regular file, directory, or internal symlink", relativePath)
		}
	}
	return nil
}

func readlinkAt(directoryFD int, name string) (string, error) {
	for size := 256; size <= 64*1024; size *= 2 {
		buffer := make([]byte, size)
		count, err := unix.Readlinkat(directoryFD, name, buffer)
		if err != nil {
			return "", err
		}
		if count < len(buffer) {
			return string(buffer[:count]), nil
		}
	}
	return "", errors.New("symlink target exceeds 64 KiB")
}

func verifyInventory(expected, actual []inventoryRecord, label string) error {
	if len(expected) != len(actual) {
		return fmt.Errorf("%s record count changed", label)
	}
	for index := range expected {
		left, right := expected[index], actual[index]
		if left.Path != right.Path || left.Type != right.Type || left.Dev != right.Dev || left.Ino != right.Ino ||
			left.UID != right.UID || left.GID != right.GID || left.Mode != right.Mode || left.Nlink != right.Nlink || left.MtimeMS != right.MtimeMS {
			return fmt.Errorf("%s identity changed at %s", label, left.Path)
		}
		switch left.Type {
		case "file":
			if left.Target != "" || right.Target != "" || left.Size != right.Size || left.SHA256 != right.SHA256 || !digestPattern.MatchString(left.SHA256) {
				return fmt.Errorf("%s file content changed at %s", label, left.Path)
			}
		case "directory":
			if left.Target != "" || left.SHA256 != "" || left.Size != 0 {
				return fmt.Errorf("%s directory record is open at %s", label, left.Path)
			}
		case "symlink":
			if left.Target != right.Target || left.SHA256 != "" || left.Size != 0 {
				return fmt.Errorf("%s symlink changed at %s", label, left.Path)
			}
		default:
			return fmt.Errorf("%s has unknown record type %q", label, left.Type)
		}
	}
	return nil
}

func inventoryDigests(inventory []inventoryRecord) (string, string, error) {
	manifest, err := canonicalJSON(inventory)
	if err != nil {
		return "", "", err
	}
	tree := make([]map[string]any, 0, len(inventory))
	for _, entry := range inventory {
		switch entry.Type {
		case "file":
			tree = append(tree, map[string]any{"path": entry.Path, "type": entry.Type, "mode": entry.Mode, "size": entry.Size, "sha256": entry.SHA256})
		case "symlink":
			tree = append(tree, map[string]any{"path": entry.Path, "type": entry.Type, "target": entry.Target})
		case "directory":
			tree = append(tree, map[string]any{"path": entry.Path, "type": entry.Type, "mode": entry.Mode})
		default:
			return "", "", fmt.Errorf("unknown inventory type %q", entry.Type)
		}
	}
	treeRaw, err := canonicalJSON(tree)
	if err != nil {
		return "", "", err
	}
	return digestBytes(manifest), digestBytes(treeRaw), nil
}

func containsInventoryPath(inventory []inventoryRecord, path, kind string) bool {
	index := sort.Search(len(inventory), func(index int) bool { return inventory[index].Path >= path })
	return index < len(inventory) && inventory[index].Path == path && inventory[index].Type == kind
}

func exactText(raw []byte, value string) bool {
	return bytes.Equal(raw, []byte(value))
}
