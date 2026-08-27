// Command generic-conformance verifies the neutral Core artifact corpus.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/tako0614/takoform/genericconformance"
	"github.com/tako0614/takoform/internal/buildinfo"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "generic-conformance:", err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer) error {
	if len(args) == 1 && args[0] == "version" {
		return buildinfo.WriteJSON(stdout, "generic-conformance")
	}
	if len(args) == 0 || args[0] != "verify" {
		err := errors.New("usage: generic-conformance version | verify --manifest PATH")
		_ = encodeFailure(stdout, err)
		return err
	}
	flags := flag.NewFlagSet("verify", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	manifest := flags.String("manifest", "", "Core artifact corpus manifest (required)")
	if err := flags.Parse(args[1:]); err != nil {
		_ = encodeFailure(stdout, err)
		return err
	}
	if flags.NArg() != 0 {
		err := errors.New("unexpected positional arguments")
		_ = encodeFailure(stdout, err)
		return err
	}
	if *manifest == "" {
		err := errors.New("verify requires --manifest")
		_ = encodeFailure(stdout, err)
		return err
	}
	report, err := genericconformance.VerifyManifest(*manifest)
	encodeErr := encode(stdout, report)
	if err != nil {
		if encodeErr != nil {
			return fmt.Errorf("verify: %w (encode report: %v)", err, encodeErr)
		}
		return err
	}
	return encodeErr
}

func encode(stdout io.Writer, report genericconformance.Report) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

func encodeFailure(stdout io.Writer, err error) error {
	return encode(stdout, genericconformance.Report{
		Format:    genericconformance.ReportFormat,
		Status:    "failed",
		Snapshots: []genericconformance.SnapshotReport{},
		Checks:    []genericconformance.Check{},
		Errors:    []string{err.Error()},
	})
}
