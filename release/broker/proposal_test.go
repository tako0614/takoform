package main

import (
	"strings"
	"testing"
)

func TestSourceReviewBindsRawSourceTreeCommitAndBroker(t *testing.T) {
	proposal := &sealedProposal{}
	proposal.Source.Commit = strings.Repeat("a", 40)
	proposal.Source.RawSourceTreeSHA256 = "sha256:" + strings.Repeat("b", 64)
	broker := runBrokerIdentity{SHA256: "sha256:" + strings.Repeat("c", 64)}
	review := sourceReview{
		Approved:            true,
		BrokerSHA256:        broker.SHA256,
		Format:              sourceReviewFormat,
		RawSourceTreeSHA256: proposal.Source.RawSourceTreeSHA256,
		Reviewed:            []string{"broker-static-boundary", "raw-reviewed-source", "sealed-closure-proposal"},
		ReviewedAt:          "2026-08-27T12:34:56.000Z",
		Reviewer:            reviewerPrincipal,
		Source:              proposal.Source.Commit,
	}
	if err := validateSourceReviewBinding(review, proposal, broker); err != nil {
		t.Fatalf("exact source review was rejected: %v", err)
	}
	for name, mutate := range map[string]func(*sourceReview){
		"raw source tree": func(value *sourceReview) { value.RawSourceTreeSHA256 = "sha256:" + strings.Repeat("d", 64) },
		"source commit":   func(value *sourceReview) { value.Source = strings.Repeat("e", 40) },
		"broker":          func(value *sourceReview) { value.BrokerSHA256 = "sha256:" + strings.Repeat("f", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			changed := review
			mutate(&changed)
			if err := validateSourceReviewBinding(changed, proposal, broker); err == nil {
				t.Fatal("changed source review binding was accepted")
			}
		})
	}
}

func TestSignedReviewRefusesChangedProposalSourceClosureRuntimeBrokerLauncherAndInvocation(t *testing.T) {
	digest := func(character string) string { return "sha256:" + strings.Repeat(character, 64) }
	makeFixture := func() (*sealedProposal, signedReview, config, string) {
		proposal := &sealedProposal{IdentityEvidence: map[string]any{
			"runtime.runtime-executable-sha256":   digest("1"),
			"launcher.launcher-executable-sha256": digest("2"),
			"launcher.launcher-config-sha256":     digest("3"),
		}}
		proposal.Source.Commit = strings.Repeat("a", 40)
		proposal.Source.RawSourceTreeSHA256 = digest("b")
		proposal.Source.ReviewRecord.SHA256 = digest("c")
		proposal.Source.InventorySHA256 = digest("d")
		proposal.Source.TreeSHA256 = digest("e")
		proposal.Invocation = invocation{Surface: "takoform-core-release", Phase: "publish", Args: []string{"takoform-core-release", "publish"}, SHA256: digest("f")}
		boundEvidence := make(map[string]any, len(proposal.IdentityEvidence))
		for key, value := range proposal.IdentityEvidence {
			boundEvidence[key] = value
		}
		proposalSHA := digest("4")
		cfg := config{namespace: reviewNamespace, reviewerPrincipal: reviewerPrincipal, trustFingerprint: pinnedTrustFingerprint}
		review := signedReview{
			Approved: true, BoundIdentityEvidence: boundEvidence, Format: reviewFormat,
			Invocation: proposal.Invocation, ProposalSHA256: proposalSHA, ReviewNamespace: cfg.namespace,
			ReviewedAt: "2026-08-27T12:34:56.000Z", Reviewer: cfg.reviewerPrincipal,
			SourceBinding: sourceBinding{
				Commit: proposal.Source.Commit, RawSourceTreeSHA256: proposal.Source.RawSourceTreeSHA256,
				SourceReviewSHA256:    proposal.Source.ReviewRecord.SHA256,
				ClosureManifestSHA256: proposal.Source.InventorySHA256, ClosureTreeSHA256: proposal.Source.TreeSHA256,
			},
			TrustRootFingerprint: cfg.trustFingerprint,
		}
		return proposal, review, cfg, proposalSHA
	}
	proposal, review, cfg, proposalSHA := makeFixture()
	if err := validateSignedReview(cfg, proposal, proposalSHA, &review); err != nil {
		t.Fatalf("exact signed review binding was rejected: %v", err)
	}
	for name, mutate := range map[string]func(*sealedProposal, *string){
		"proposal": func(_ *sealedProposal, sha *string) { *sha = digest("5") },
		"source":   func(value *sealedProposal, _ *string) { value.Source.Commit = strings.Repeat("6", 40) },
		"closure":  func(value *sealedProposal, _ *string) { value.Source.TreeSHA256 = digest("7") },
		"runtime": func(value *sealedProposal, _ *string) {
			value.IdentityEvidence["runtime.runtime-executable-sha256"] = digest("8")
		},
		"broker": func(value *sealedProposal, _ *string) {
			value.IdentityEvidence["launcher.launcher-executable-sha256"] = digest("9")
		},
		"launcher": func(value *sealedProposal, _ *string) {
			value.IdentityEvidence["launcher.launcher-config-sha256"] = digest("0")
		},
		"invocation": func(value *sealedProposal, _ *string) { value.Invocation.Phase = "audit" },
	} {
		t.Run(name, func(t *testing.T) {
			changedProposal, unchangedReview, changedConfig, changedSHA := makeFixture()
			mutate(changedProposal, &changedSHA)
			if err := validateSignedReview(changedConfig, changedProposal, changedSHA, &unchangedReview); err == nil {
				t.Fatal("changed reviewed binding was accepted")
			}
		})
	}
}
