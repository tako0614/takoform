package main

import (
	"bytes"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

func validateDetachedGitMetadata(sourceRoot, commit string, inventory []inventoryRecord) error {
	if !containsInventoryPath(inventory, ".git", "directory") ||
		!containsInventoryPath(inventory, ".git/HEAD", "file") ||
		!containsInventoryPath(inventory, ".git/config", "file") ||
		!containsInventoryPath(inventory, ".git/hooks", "directory") {
		return errors.New("sealed source lacks minimal standalone Git metadata")
	}
	forbiddenExact := []string{
		".git/commondir", ".git/config.worktree", ".git/gitdir", ".git/shallow",
		".git/info/attributes", ".git/info/grafts", ".git/modules",
		".git/objects/info/alternates", ".git/objects/info/http-alternates",
		".git/objects/info/commit-graph", ".git/objects/info/commit-graphs",
		".git/objects/pack/multi-pack-index", ".git/refs/remotes", ".git/refs/replace", ".git/worktrees",
	}
	for _, path := range forbiddenExact {
		for _, entry := range inventory {
			if entry.Path == path || strings.HasPrefix(entry.Path, path+"/") {
				return fmt.Errorf("sealed source rejects Git metadata %s", path)
			}
		}
	}
	for _, entry := range inventory {
		if strings.HasPrefix(entry.Path, ".git/hooks/") {
			return fmt.Errorf("sealed source rejects Git hook %s", entry.Path)
		}
		if strings.HasPrefix(entry.Path, ".git/objects/pack/") && strings.HasSuffix(entry.Path, ".promisor") {
			return fmt.Errorf("sealed source rejects promisor object metadata %s", entry.Path)
		}
	}
	head, err := openStableRegularFile(filepath.Join(sourceRoot, ".git", "HEAD"), "detached Git HEAD", stableFilePolicy{
		maximum: 128, exactMode: 0o444, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return err
	}
	defer head.close()
	if !exactBytes(head.raw, []byte(commit+"\n")) {
		return errors.New("sealed source Git HEAD is not exact detached source S")
	}
	configuration, err := openStableRegularFile(filepath.Join(sourceRoot, ".git", "config"), "sealed Git config", stableFilePolicy{
		maximum: 64 * 1024, exactMode: 0o444, exactNlink: 1, allowAnyOwner: true,
	})
	if err != nil {
		return err
	}
	defer configuration.close()
	if err := validateMinimalGitConfig(configuration.raw); err != nil {
		return err
	}
	for _, entry := range inventory {
		if entry.Path != ".git/packed-refs" {
			continue
		}
		packed, err := openStableRegularFile(filepath.Join(sourceRoot, ".git", "packed-refs"), "sealed packed refs", stableFilePolicy{
			maximum: 16 * 1024 * 1024, exactMode: 0o444, exactNlink: 1, allowAnyOwner: true,
		})
		if err != nil {
			return err
		}
		unsafe := bytes.Contains(packed.raw, []byte("refs/replace/")) || bytes.Contains(packed.raw, []byte("refs/remotes/"))
		packed.close()
		if unsafe {
			return errors.New("sealed packed refs contain replacement or remote refs")
		}
	}
	return nil
}

func validateMinimalGitConfig(raw []byte) error {
	if len(raw) == 0 || bytes.ContainsAny(raw, "\x00\r") {
		return errors.New("sealed Git config is empty or noncanonical")
	}
	section := ""
	values := map[string]string{}
	for _, rawLine := range strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.TrimSpace(line[1 : len(line)-1]))
			if section != "core" {
				return fmt.Errorf("sealed Git config rejects section %q", section)
			}
			continue
		}
		separator := strings.IndexRune(line, '=')
		if separator < 1 || section == "" {
			return errors.New("sealed Git config has malformed assignment")
		}
		key := section + "." + strings.ToLower(strings.TrimSpace(line[:separator]))
		value := strings.ToLower(strings.TrimSpace(line[separator+1:]))
		if _, duplicate := values[key]; duplicate {
			return fmt.Errorf("sealed Git config repeats %s", key)
		}
		values[key] = value
	}
	expected := map[string]string{
		"core.repositoryformatversion": "0",
		"core.filemode":                "true",
		"core.bare":                    "false",
		"core.logallrefupdates":        "true",
	}
	if len(values) != len(expected) {
		return errors.New("sealed Git config is not the minimal detached allowlist")
	}
	for key, value := range expected {
		if values[key] != value {
			return fmt.Errorf("sealed Git config %s differs", key)
		}
	}
	return nil
}
