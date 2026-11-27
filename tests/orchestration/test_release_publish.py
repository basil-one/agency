import json
import os
import unittest
from unittest.mock import patch

from scripts.orchestration import release_publish as release


HEAD = "a" * 40
MERGE = "b" * 40
BASE = "c" * 40
CHANGELOG = "# Changelog\n\n## [Unreleased]\n\n### Added\n- A reviewed outcome.\n"
ENV = {
    "GITHUB_REPOSITORY": "basil-one/agency",
    "GITHUB_EVENT_NAME": "workflow_dispatch",
    "GITHUB_REF": "refs/heads/main",
}


def checks():
    return [
        {
            "id": index + 1,
            "name": name,
            "head_sha": HEAD,
            "app": {"id": release.APP_ID},
            "status": "completed",
            "conclusion": "success",
            "started_at": "2026-11-27T15:00:00Z",
        }
        for index, name in enumerate(release.CHECKS)
    ]


def pr():
    return {
        "number": 42,
        "title": "Prepare Agency release v1.0.0",
        "state": "closed",
        "merged": True,
        "merged_at": "2026-11-27T15:10:00Z",
        "merge_commit_sha": MERGE,
        "head": {"ref": "release/v1.0.0", "sha": HEAD, "repo": {"full_name": release.REPOSITORY}},
        "base": {"ref": "main", "repo": {"full_name": release.REPOSITORY}},
    }


class VersionAndChecksTests(unittest.TestCase):
    def test_initial_release_and_changelog_only_promotion(self):
        promoted = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        self.assertIn("## [1.0.0] - 2026-11-27\n\n### Added\n- A reviewed outcome.", promoted)
        self.assertEqual(release.notes("1.0.0", promoted), "### Added\n- A reviewed outcome.\n")
        self.assertNotIn("/compare/v0", promoted)
        with self.assertRaises(release.ReleaseError):
            release.promote("1.0.0", "2026-11-27", CHANGELOG.replace("- A reviewed outcome.", ""), [])

    def test_version_validation_and_prior_history(self):
        for value in ("v1.0.0", "1.0", "01.0.0", "1.0.0-rc.1", " 1.0.0"):
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.version_tuple(value)
        first = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        next_text = first.replace("## [Unreleased]\n", "## [Unreleased]\n\n- Next.\n")
        second = release.promote("1.0.1", "2026-11-28", next_text, ["v1.0.0"])
        self.assertIn("compare/v1.0.0...v1.0.1", second)
        with self.assertRaises(release.ReleaseError):
            release.promote("1.0.1", "2026-11-28", next_text, [])

    def test_gate_requires_exact_eight_successful_checks(self):
        self.assertEqual(len(release.CHECKS), 8)
        self.assertEqual(len(release.verify_checks(checks(), HEAD)), 8)
        for change in (
            lambda rows: rows.pop(),
            lambda rows: rows[0].update(app={"id": 1}),
            lambda rows: rows[0].update(head_sha=MERGE),
            lambda rows: rows[0].update(conclusion="skipped"),
            lambda rows: rows[0].update(status="in_progress", conclusion=None),
            lambda rows: rows.append({**rows[0], "id": 100, "conclusion": "failure"}),
        ):
            rows = checks()
            change(rows)
            with self.subTest(rows=rows), self.assertRaises(release.ReleaseError):
                release.verify_checks(rows, HEAD)

    def test_paginated_check_evidence_requires_full_consistent_pages(self):
        first = [{**checks()[0], "id": index + 1} for index in range(100)]
        last = [{**checks()[1], "id": 101}]
        with patch.object(release, "api", side_effect=[
            {"total_count": 101, "check_runs": first},
            {"total_count": 101, "check_runs": last},
        ]) as api:
            self.assertEqual(len(release.check_pages(release.REPOSITORY, HEAD)), 101)
            self.assertEqual(api.call_count, 2)
        with patch.object(release, "api", return_value={"total_count": 101, "check_runs": first[:1]}):
            with self.assertRaises(release.ReleaseError):
                release.check_pages(release.REPOSITORY, HEAD)


class PublisherTests(unittest.TestCase):
    def publisher(self):
        with patch.dict(os.environ, ENV, clear=True):
            return release.Publisher()

    def test_non_main_and_non_manual_are_rejected(self):
        for key, value in (("GITHUB_REF", "refs/heads/other"), ("GITHUB_EVENT_NAME", "push"),
                           ("GITHUB_REPOSITORY", "other/repo")):
            with patch.dict(os.environ, {**ENV, key: value}, clear=True):
                with self.assertRaises(release.ReleaseError):
                    release.Publisher()

    def test_pr_identity_and_single_file_are_required(self):
        publisher = self.publisher()
        with patch.object(release, "pages", return_value=[{"filename": "CHANGELOG.md", "status": "modified"}]):
            self.assertEqual(publisher.verify_pr(pr(), "1.0.0"), HEAD)
            invalid = pr()
            invalid["head"]["repo"]["full_name"] = "attacker/fork"
            with self.assertRaises(release.ReleaseError):
                publisher.verify_pr(invalid, "1.0.0")
        with patch.object(release, "pages", return_value=[{"filename": "README.md", "status": "modified"}]):
            with self.assertRaises(release.ReleaseError):
                publisher.verify_pr(pr(), "1.0.0")

    def test_merge_squash_rebase_evidence_and_divergent_tree(self):
        publisher = self.publisher()
        for mode in ("merge", "squash", "rebase"):
            def fake_git(*args):
                if args[0] == "rev-parse" and args[1].startswith("refs/remotes/"):
                    return HEAD
                if args[0] == "rev-parse" and args[1].endswith("^{tree}"):
                    return "tree"
                if args[0] == "rev-parse":
                    return BASE
                if args[0] == "merge-base":
                    return BASE
                return ""
            with self.subTest(mode=mode), patch.object(publisher, "verify_pr", return_value=HEAD), \
                    patch.object(publisher, "main", return_value=MERGE), \
                    patch.object(publisher, "verify_promotion") as promotion, \
                    patch.object(release, "git", side_effect=fake_git), \
                    patch.object(release, "ancestor", return_value=True), \
                    patch.object(release, "check_pages", return_value=checks()):
                self.assertEqual(publisher.merged(pr(), "1.0.0")[:2], (MERGE, HEAD))
                promotion.assert_called_once_with(HEAD, BASE, "1.0.0")
        with patch.object(publisher, "verify_pr", return_value=HEAD), \
                patch.object(publisher, "main", return_value=MERGE), \
                patch.object(release, "ancestor", return_value=True), \
                patch.object(release, "git", side_effect=["", HEAD, "tree-a", "tree-b"]):
            with self.assertRaisesRegex(release.ReleaseError, "tree"):
                publisher.merged(pr(), "1.0.0")

    def test_tag_provenance_structure_alone_is_not_authentication(self):
        publisher = self.publisher()
        evidence = {"version": "1.0.0", "pr": 42, "head": HEAD, "source": MERGE,
                    "checks": {name: index + 1 for index, name in enumerate(release.CHECKS)}}
        message = "Agency Release Publish provenance\n" + json.dumps(evidence)
        with patch.object(release, "git", side_effect=[MERGE, "tag", message]):
            self.assertEqual(publisher.tag_provenance("v1.0.0", MERGE, HEAD, 42, "1.0.0"), evidence["checks"])
        evidence["checks"].pop(release.CHECKS[0])
        with patch.object(release, "git", side_effect=[MERGE, "tag", "Agency Release Publish provenance\n" + json.dumps(evidence)]):
            with self.assertRaises(release.ReleaseError):
                publisher.tag_provenance("v1.0.0", MERGE, HEAD, 42, "1.0.0")

    def test_release_is_disabled_before_any_mutation_or_api_access(self):
        publisher = self.publisher()
        with patch.object(release, "api", side_effect=AssertionError("unexpected API access")), \
                patch.object(release, "git", side_effect=AssertionError("unexpected git access")):
            with self.assertRaisesRegex(release.ReleaseError, "disabled"):
                publisher.prepare("1.0.0")
            with self.assertRaisesRegex(release.ReleaseError, "disabled"):
                publisher.release("1.0.0", pr())

    def test_exact_promotion_rejects_non_changelog_changes(self):
        publisher = self.publisher()
        with patch.object(release, "ancestor", return_value=True), \
                patch.object(release, "git", return_value="CHANGELOG.md\nREADME.md"):
            with self.assertRaisesRegex(release.ReleaseError, "more than"):
                publisher.verify_promotion(HEAD, BASE, "1.0.0")

    def test_closed_unmerged_pr_is_rejected(self):
        publisher = self.publisher()
        candidate = pr()
        candidate.update(merged=False, merged_at=None)
        with patch.object(release, "pages", return_value=[{"filename": "CHANGELOG.md", "status": "modified"}]):
            with self.assertRaisesRegex(release.ReleaseError, "closed without merging"):
                publisher.verify_pr(candidate, "1.0.0")


if __name__ == "__main__":
    unittest.main()
