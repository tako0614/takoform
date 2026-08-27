// Package buildinfo owns the module identity reported by public Core commands.
// Vanilla `go install module/cmd@version` builds derive the version and module
// sum from runtime build information. Version and Commit remain injection
// points only for locally qualified builds that actually embed those values.
package buildinfo

import (
	"encoding/json"
	"io"
	"runtime/debug"
	"strings"
)

const Module = "github.com/tako0614/takoform"

var (
	Version = "devel"
	Commit  = ""
)

type Info struct {
	Command string `json:"command"`
	Module  string `json:"module"`
	Version string `json:"version"`
	Sum     string `json:"sum,omitempty"`
	Commit  string `json:"commit,omitempty"`
}

func Current(command string) Info {
	build, ok := debug.ReadBuildInfo()
	return resolve(command, build, ok, Version, Commit)
}

func resolve(command string, build *debug.BuildInfo, ok bool, injectedVersion, injectedCommit string) Info {
	info := Info{
		Command: command,
		Module:  Module,
		Version: injectedVersion,
	}
	if info.Version == "" {
		info.Version = "devel"
	}
	if validCommit(injectedCommit) {
		info.Commit = injectedCommit
	}
	if !ok || build == nil || build.Main.Path != Module {
		return info
	}
	if build.Main.Version != "" && build.Main.Version != "(devel)" {
		info.Version = build.Main.Version
	}
	if strings.HasPrefix(build.Main.Sum, "h1:") {
		info.Sum = build.Main.Sum
	}
	if info.Commit == "" {
		for _, setting := range build.Settings {
			if setting.Key == "vcs.revision" && validCommit(setting.Value) {
				info.Commit = setting.Value
				break
			}
		}
	}
	return info
}

func WriteJSON(output io.Writer, command string) error {
	return json.NewEncoder(output).Encode(Current(command))
}

func validCommit(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
