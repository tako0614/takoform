package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/tako0614/takoform/formpackage"
	"github.com/tako0614/takoform/internal/buildinfo"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "form-package:", err)
		os.Exit(1)
	}
}

func run(arguments []string, output io.Writer) error {
	if len(arguments) == 0 {
		return usageError()
	}
	switch arguments[0] {
	case "version":
		if len(arguments) != 1 {
			return usageError()
		}
		return buildinfo.WriteJSON(output, "form-package")
	case "verify":
		if len(arguments) != 2 {
			return usageError()
		}
		report, err := formpackage.VerifyDirectory(arguments[1])
		if err != nil {
			return err
		}
		return writeJSON(output, report)
	case "canonicalize":
		if len(arguments) != 2 {
			return usageError()
		}
		raw, err := os.ReadFile(arguments[1])
		if err != nil {
			return err
		}
		canonical, err := formpackage.Canonicalize(raw)
		if err != nil {
			return err
		}
		_, err = output.Write(append(canonical, '\n'))
		return err
	case "digest":
		if len(arguments) != 2 {
			return usageError()
		}
		raw, err := os.ReadFile(arguments[1])
		if err != nil {
			return err
		}
		digest, err := formpackage.DigestCanonicalJSON(raw)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintln(output, digest)
		return err
	case "validate-revocation":
		if len(arguments) != 2 {
			return usageError()
		}
		raw, err := os.ReadFile(arguments[1])
		if err != nil {
			return err
		}
		statement, err := formpackage.ValidateRevocationStatement(raw)
		if err != nil {
			return err
		}
		return writeJSON(output, statement)
	case "validate-revocation-checkpoint":
		if len(arguments) != 2 {
			return usageError()
		}
		raw, err := os.ReadFile(arguments[1])
		if err != nil {
			return err
		}
		checkpoint, err := formpackage.ValidateRevocationCheckpoint(raw)
		if err != nil {
			return err
		}
		return writeJSON(output, checkpoint)
	default:
		return usageError()
	}
}

func writeJSON(output io.Writer, value any) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func usageError() error {
	return fmt.Errorf("usage: form-package version | verify DIR | canonicalize FILE | digest FILE | validate-revocation FILE | validate-revocation-checkpoint FILE")
}
