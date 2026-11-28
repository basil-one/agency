import json
import os
import subprocess
import unittest
from unittest.mock import patch

from scripts.orchestration import release_publish as release

HEAD = "a" * 40
MERGE = "b" * 40
BASE = "c" * 40
TAG = "d" * 40
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
        "merged_by": {"type": "User", "login": "reviewer"},
        "merge_commit_sha": MERGE,
        "head": {"ref": "release/v1.0.0", "sha": HEAD, "repo": {"full_name": release.REPOSITORY}},
        "base": {"ref": "main", "repo": {"full_name": release.REPOSITORY}},
    }


class Lifecycle:
    def __init__(self):
        self.tag = None
        self.item = None
        self.interrupt = True
        self.check_count = 0
        self.write_count = 0

    def revision(self, ref):
        if ref == "refs/tags/v1.0.0":
            return TAG
        if ref in ("HEAD", "refs/remotes/origin/main") or ref.endswith("^{commit}"):
            return MERGE
        if ref.startswith("refs/remotes/release-pr"):
            return HEAD
        return "tree" if ref.endswith("^{tree}") else BASE

    def git(self, *args):
        if args[0] == "rev-parse":
            return self.revision(args[1])
        if args[0] == "merge-base":
            return BASE
        if args[0] == "rev-list":
            return f"{MERGE} {BASE}"
        if args[0] == "diff":
            return "CHANGELOG.md"
        if args[0] == "tag":
            return "v1.0.0" if self.tag and "--merged" not in args else ""
        if args[0] == "cat-file":
            return "tag"
        if args[0] == "for-each-ref":
            return self.tag
        if "tag" in args and "-a" in args:
            self.tag = args[args.index("-m") + 1]
        if "tag" in args and "-a" in args or args[0] == "push":
            self.write_count += 1
        return ""

    def command(self, args, **_kwargs):
        remote = args[1] == "ls-remote"
        result = 0 if self.tag else (2 if remote else 1)
        output = f"{TAG}\trefs/tags/v1.0.0\n" if self.tag and remote else ""
        return subprocess.CompletedProcess(args, result, output, "")

    def write(self, method, data):
        self.write_count += 1
        if method == "POST":
            self.item = {"id": 5, "assets": [], **data}
        elif self.interrupt:
            self.interrupt = False
            raise release.ReleaseError("interrupted")
        else:
            self.item["draft"] = False
        return self.item.copy()

    def api(self, path, method="GET", data=None):
        if method != "GET":
            return self.write(method, data)
        if "/pulls?" in path:
            return [] if "state=open" in path else [{"number": 42}]
        if "/pulls/42/files" in path:
            return [{"filename": "CHANGELOG.md", "status": "modified"}]
        if path.endswith("/pulls/42"):
            return pr()
        if "/releases?" in path:
            return [self.item.copy()] if self.item else []
        if "/check-runs?" in path:
            self.check_count += 1
            return {"total_count": 8, "check_runs": checks()}
        raise AssertionError(path)


class VersionAndChecksTests(unittest.TestCase):
    def test_initial_release_and_changelog_only_promotion(self):
        promoted = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        self.assertIn("## [1.0.0] - 2026-11-27\n\n### Added\n- A reviewed outcome.", promoted)
        self.assertEqual(release.notes("1.0.0", promoted), "### Added\n- A reviewed outcome.\n")
        self.assertNotIn("/compare/v0", promoted)
        with self.assertRaises(release.ReleaseError):
            release.promote(
                "1.0.0", "2026-11-27", CHANGELOG.replace("- A reviewed outcome.", ""), []
            )

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

    def test_latest_success_supersedes_old_failure_but_duplicate_is_ambiguous(self):
        rows = checks()
        old = {**rows[0], "id": 99, "conclusion": "failure", "started_at": "2026-11-26T00:00:00Z"}
        self.assertEqual(release.verify_checks(rows + [old], HEAD)[release.CHECKS[0]], 1)
        old["started_at"] = rows[0]["started_at"]
        with self.assertRaisesRegex(release.ReleaseError, "Ambiguous"):
            release.verify_checks(rows + [old], HEAD)

    def test_paginated_check_evidence_requires_full_consistent_pages(self):
        first = [{**checks()[0], "id": index + 1} for index in range(100)]
        last = [{**checks()[1], "id": 101}]
        with patch.object(
            release,
            "api",
            side_effect=[
                {"total_count": 101, "check_runs": first},
                {"total_count": 101, "check_runs": last},
            ],
        ) as api:
            self.assertEqual(len(release.check_pages(release.REPOSITORY, HEAD)), 101)
            self.assertEqual(api.call_count, 2)
        with patch.object(
            release, "api", return_value={"total_count": 101, "check_runs": first[:1]}
        ):
            with self.assertRaises(release.ReleaseError):
                release.check_pages(release.REPOSITORY, HEAD)

    def test_old_release_notes_remain_available(self):
        text = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        text = text.replace("## [Unreleased]\n", "## [Unreleased]\n\n- Next.\n")
        text = release.promote("1.0.1", "2026-11-28", text, ["v1.0.0"])
        self.assertEqual(release.notes("1.0.0", text), "### Added\n- A reviewed outcome.\n")


class PublisherTests(unittest.TestCase):
    def publisher(self):
        with patch.dict(os.environ, ENV, clear=True):
            return release.Publisher()

    def test_non_main_and_non_manual_are_rejected(self):
        for key, value in (
            ("GITHUB_REF", "refs/heads/other"),
            ("GITHUB_EVENT_NAME", "push"),
            ("GITHUB_REPOSITORY", "other/repo"),
        ):
            with patch.dict(os.environ, {**ENV, key: value}, clear=True):
                with self.assertRaises(release.ReleaseError):
                    release.Publisher()

    def test_pr_identity_and_single_file_are_required(self):
        publisher = self.publisher()
        with patch.object(
            release, "pages", return_value=[{"filename": "CHANGELOG.md", "status": "modified"}]
        ):
            self.assertEqual(publisher.verify_pr(pr(), "1.0.0"), HEAD)
            invalid = pr()
            invalid["head"]["repo"]["full_name"] = "attacker/fork"
            with self.assertRaises(release.ReleaseError):
                publisher.verify_pr(invalid, "1.0.0")
        with patch.object(
            release, "pages", return_value=[{"filename": "README.md", "status": "modified"}]
        ):
            with self.assertRaises(release.ReleaseError):
                publisher.verify_pr(pr(), "1.0.0")

    def test_exact_promotion_rejects_modified_entries(self):
        publisher = self.publisher()
        promoted = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        altered = promoted.replace("reviewed outcome", "different outcome")
        with (
            patch.object(release, "ancestor", return_value=True),
            patch.object(release, "git", return_value="CHANGELOG.md"),
            patch.object(release, "changelog", side_effect=[altered, CHANGELOG]),
            patch.object(publisher, "tags", return_value=[]),
            self.assertRaisesRegex(release.ReleaseError, "exact promotion"),
        ):
            publisher.verify_promotion(HEAD, BASE, "1.0.0")

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
                if args[0] == "rev-list":
                    return f"{MERGE} {BASE}" if mode != "merge" else f"{MERGE} {BASE} {HEAD}"
                if args[0] == "diff":
                    return "CHANGELOG.md"
                return ""

            with (
                self.subTest(mode=mode),
                patch.object(publisher, "verify_pr", return_value=HEAD),
                patch.object(publisher, "main", return_value=MERGE),
                patch.object(publisher, "verify_promotion") as promotion,
                patch.object(publisher, "promotion_base", return_value=BASE),
                patch.object(release, "git", side_effect=fake_git),
                patch.object(release, "ancestor", return_value=True),
                patch.object(release, "check_pages", return_value=checks()),
            ):
                self.assertEqual(publisher.merged(pr(), "1.0.0")[:2], (MERGE, HEAD))
                promotion.assert_called_once_with(HEAD, BASE, "1.0.0")
        with (
            patch.object(publisher, "verify_pr", return_value=HEAD),
            patch.object(publisher, "main", return_value=MERGE),
            patch.object(release, "ancestor", return_value=True),
            patch.object(release, "git", side_effect=["", HEAD, "tree-a", "tree-b"]),
        ):
            with self.assertRaisesRegex(release.ReleaseError, "tree"):
                publisher.merged(pr(), "1.0.0")

    def test_tag_provenance_structure_alone_is_not_authentication(self):
        publisher = self.publisher()
        evidence = {
            "version": "1.0.0",
            "pr": 42,
            "head": HEAD,
            "source": MERGE,
        }
        message = "Agency Release Publish provenance\n" + json.dumps(evidence)
        with patch.object(release, "git", side_effect=[MERGE, "tag", message]):
            publisher.tag_provenance("v1.0.0", MERGE, HEAD, 42, "1.0.0")
        evidence["head"] = BASE
        with patch.object(
            release,
            "git",
            side_effect=[
                MERGE,
                "tag",
                "Agency Release Publish provenance\n" + json.dumps(evidence),
            ],
        ):
            with self.assertRaises(release.ReleaseError):
                publisher.tag_provenance("v1.0.0", MERGE, HEAD, 42, "1.0.0")

    def test_exact_promotion_rejects_non_changelog_changes(self):
        publisher = self.publisher()
        with (
            patch.object(release, "ancestor", return_value=True),
            patch.object(release, "git", return_value="CHANGELOG.md\nREADME.md"),
        ):
            with self.assertRaisesRegex(release.ReleaseError, "more than"):
                publisher.verify_promotion(HEAD, BASE, "1.0.0")

    def test_closed_unmerged_pr_is_rejected(self):
        publisher = self.publisher()
        candidate = pr()
        candidate.update(merged=False, merged_at=None)
        with patch.object(
            release, "pages", return_value=[{"filename": "CHANGELOG.md", "status": "modified"}]
        ):
            with self.assertRaisesRegex(release.ReleaseError, "closed without merging"):
                publisher.verify_pr(candidate, "1.0.0")

    def test_merge_requires_a_human_user(self):
        publisher = self.publisher()
        for merger in (None, {}, {"type": "Bot"}, {"type": "Organization"}):
            candidate = {**pr(), "merged_by": merger}
            with (
                self.subTest(merger=merger),
                patch.object(publisher, "verify_pr", return_value=HEAD),
                patch.object(release, "git") as git,
                self.assertRaisesRegex(release.ReleaseError, "human"),
            ):
                publisher.merged(candidate, "1.0.0")
            git.assert_not_called()

    def test_merge_rejects_unrelated_parent_or_wrong_merge_head(self):
        publisher = self.publisher()
        for parents, ancestry in (
            (f"{MERGE} {BASE} {TAG}", True),
            (f"{MERGE} {BASE} {HEAD}", False),
        ):
            with (
                self.subTest(parents=parents),
                patch.object(publisher, "verify_pr", return_value=HEAD),
                patch.object(publisher, "main", return_value=MERGE),
                patch.object(release, "git", side_effect=["", HEAD, "tree", "tree", parents]),
                patch.object(release, "ancestor", side_effect=[True, ancestry]),
                patch.object(publisher, "verify_promotion") as promotion,
                self.assertRaisesRegex(release.ReleaseError, "parents"),
            ):
                publisher.merged(pr(), "1.0.0")
            promotion.assert_not_called()

    def test_multi_commit_rebase_requires_linear_changelog_only_history(self):
        publisher = self.publisher()
        git_results = [
            "",
            HEAD,
            "tree",
            "tree",
            f"{MERGE} {TAG}",
            BASE,
            f"{MERGE} {TAG}\n{TAG} {BASE}",
            "CHANGELOG.md",
            "CHANGELOG.md",
        ]
        with (
            patch.object(publisher, "verify_pr", return_value=HEAD),
            patch.object(publisher, "main", return_value=MERGE),
            patch.object(release, "git", side_effect=git_results),
            patch.object(release, "ancestor", return_value=True),
            patch.object(publisher, "verify_promotion") as promotion,
            patch.object(publisher, "promotion_base", return_value=BASE),
        ):
            self.assertEqual(publisher.merged(pr(), "1.0.0", checks=False), (MERGE, HEAD, None))
        promotion.assert_called_once_with(HEAD, BASE, "1.0.0")
        for rows, changes in (
            (f"{MERGE} {TAG}\n{TAG} {BASE} {HEAD}", ["CHANGELOG.md"]),
            (f"{MERGE} {TAG}\n{TAG} {BASE}", ["README.md"]),
            (f"{MERGE} {TAG}", ["CHANGELOG.md"]),
        ):
            with (
                self.subTest(rows=rows, changes=changes),
                patch.object(release, "git", side_effect=[rows, *changes]),
                self.assertRaises(release.ReleaseError),
            ):
                release.verify_linear_merge(BASE, MERGE)

    def test_divergent_or_missing_remote_tag_is_rejected(self):
        publisher = self.publisher()
        for status, output in ((2, ""), (0, f"{BASE}\trefs/tags/v1.0.0\n")):
            with (
                self.subTest(status=status),
                patch.object(
                    release,
                    "command",
                    side_effect=[
                        subprocess.CompletedProcess([], 0, "", ""),
                        subprocess.CompletedProcess([], status, output, ""),
                    ],
                ),
                patch.object(release, "git", return_value=TAG),
                patch.object(publisher, "tag_provenance") as provenance,
                self.assertRaisesRegex(release.ReleaseError, "tags differ"),
            ):
                publisher.ensure_tag("1.0.0", pr(), MERGE, HEAD, None, False)
            provenance.assert_not_called()

    def test_prepare_rejects_stale_branch(self):
        publisher = self.publisher()
        candidate = pr()
        candidate.update(state="open", merged=False, merged_at=None)
        with (
            patch.object(publisher, "main", return_value=BASE),
            patch.object(release, "git", side_effect=[BASE, "", HEAD]),
            patch.object(publisher, "pull_requests", return_value=candidate),
            patch.object(publisher, "reject_competing_prs"),
            patch.object(publisher, "verify_pr", return_value=HEAD),
            patch.object(release, "ancestor", return_value=False),
            self.assertRaisesRegex(release.ReleaseError, "stale"),
        ):
            publisher.prepare("1.0.0")

    def test_prepare_requires_current_main_dispatch(self):
        publisher = self.publisher()
        with (
            patch.object(publisher, "main", return_value=MERGE),
            patch.object(release, "git", return_value=BASE),
            patch.object(publisher, "pull_requests") as prs,
            self.assertRaisesRegex(release.ReleaseError, "not current main"),
        ):
            publisher.prepare("1.0.0")
        prs.assert_not_called()

    def test_prepare_reuses_existing_branch_after_pr_creation_interrupted(self):
        publisher = self.publisher()
        with (
            patch.object(publisher, "main", return_value=BASE),
            patch.object(publisher, "pull_requests", return_value=None),
            patch.object(publisher, "reject_competing_prs"),
            patch.object(publisher, "existing_release", return_value=None),
            patch.object(publisher, "tags", return_value=[]),
            patch.object(publisher, "verify_promotion") as promotion,
            patch.object(publisher, "create_pr", return_value=pr()) as create,
            patch.object(release, "git", side_effect=[BASE, f"{HEAD}\tref", "", HEAD]) as git,
        ):
            self.assertEqual(publisher.prepare("1.0.0"), pr())
        promotion.assert_called_once_with(HEAD, BASE, "1.0.0")
        create.assert_called_once_with("1.0.0", "release/v1.0.0")
        self.assertFalse(any(call.args[0] in ("push", "switch") for call in git.call_args_list))

    def test_retained_published_branch_does_not_block_next_release(self):
        publisher = self.publisher()
        old_branch = f"{HEAD}\trefs/heads/release/v1.0.0"
        previous = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        current = previous.replace("## [Unreleased]\n", "## [Unreleased]\n\n- Next.\n")

        def fake_git(*args):
            if args == ("rev-parse", "HEAD"):
                return BASE
            if args == ("ls-remote", "--heads", "origin", "refs/heads/release/v*"):
                return old_branch
            return ""

        def fake_pages(path):
            return [{"tag_name": "v1.0.0", "draft": False}] if "/releases" in path else []

        with (
            patch.object(publisher, "main", return_value=BASE),
            patch.object(publisher, "pull_requests", return_value=None),
            patch.object(publisher, "existing_release", return_value=None),
            patch.object(publisher, "tags", return_value=["v1.0.0"]),
            patch.object(publisher, "create_pr", return_value=pr()) as create,
            patch.object(release, "pages", side_effect=fake_pages),
            patch.object(release, "changelog", return_value=current),
            patch.object(release.Path, "write_text"),
            patch.object(release, "git", side_effect=fake_git) as git,
        ):
            publisher.prepare("1.0.1")
        create.assert_called_once_with("1.0.1", "release/v1.0.1")
        git.assert_any_call("push", "origin", "HEAD:refs/heads/release/v1.0.1")

    def test_other_open_release_pr_still_blocks(self):
        publisher = self.publisher()
        with patch.object(
            release, "pages", return_value=[{"head": {"ref": "release/v1.0.0"}}]
        ):
            with self.assertRaisesRegex(release.ReleaseError, "Another release PR"):
                publisher.reject_competing_prs("release/v1.0.1")

    def test_live_check_failure_stops_before_tag_or_release(self):
        publisher = self.publisher()
        failed = checks()
        failed[0]["conclusion"] = "failure"
        with (
            patch.object(release, "api", return_value=pr()),
            patch.object(publisher, "existing_release", return_value=None),
            patch.object(publisher, "verify_pr", return_value=HEAD),
            patch.object(publisher, "main", return_value=MERGE),
            patch.object(publisher, "verify_promotion"),
            patch.object(publisher, "promotion_base", return_value=BASE),
            patch.object(release, "ancestor", return_value=True),
            patch.object(
                release,
                "git",
                side_effect=[
                    "",
                    HEAD,
                    "tree",
                    "tree",
                    f"{MERGE} {BASE}",
                    BASE,
                    f"{MERGE} {BASE}",
                    "CHANGELOG.md",
                ],
            ),
            patch.object(release, "check_pages", return_value=failed),
            patch.object(publisher, "ensure_tag") as tag,
            self.assertRaisesRegex(release.ReleaseError, "not successful"),
        ):
            publisher.release("1.0.0", pr())
        tag.assert_not_called()

    def test_completed_release_uses_record_without_expired_checks_or_writes(self):
        publisher = self.publisher()
        approved = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        item = {
            "id": 4,
            "tag_name": "v1.0.0",
            "name": "v1.0.0",
            "body": release.notes("1.0.0", approved),
            "draft": False,
            "prerelease": False,
            "assets": [],
        }
        with (
            patch.object(release, "api", return_value=pr()) as api,
            patch.object(publisher, "existing_release", return_value=item),
            patch.object(publisher, "merged", return_value=(MERGE, HEAD, None)) as merged,
            patch.object(publisher, "main", return_value=MERGE),
            patch.object(publisher, "tags", return_value=["v1.0.0", "v1.0.1"]),
            patch.object(release, "ancestor", return_value=True),
            patch.object(release, "changelog", return_value=approved),
            patch.object(publisher, "ensure_tag") as tag,
        ):
            publisher.release("1.0.0", pr())
        merged.assert_called_once_with(pr(), "1.0.0", checks=False)
        tag.assert_called_once_with("1.0.0", pr(), MERGE, HEAD, item, True)
        self.assertEqual(api.call_count, 1)

    def test_conflicting_draft_stops_before_tag_or_publication(self):
        publisher = self.publisher()
        approved = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        item = {"tag_name": "v1.0.0", "draft": True}
        with (
            patch.object(release, "api", return_value=pr()) as api,
            patch.object(publisher, "existing_release", return_value=item),
            patch.object(publisher, "merged", return_value=(MERGE, HEAD, {})),
            patch.object(publisher, "main", return_value=MERGE),
            patch.object(publisher, "tags", return_value=[]),
            patch.object(release, "ancestor", return_value=True),
            patch.object(release, "changelog", return_value=approved),
            patch.object(publisher, "ensure_tag") as tag,
            self.assertRaises(release.ReleaseError),
        ):
            publisher.release("1.0.0", pr())
        tag.assert_not_called()
        self.assertEqual(api.call_count, 1)

    def test_existing_tag_recovery_accepts_newer_live_checks(self):
        publisher = self.publisher()
        with (
            patch.object(
                release,
                "command",
                side_effect=[
                    subprocess.CompletedProcess([], 0, "", ""),
                    subprocess.CompletedProcess([], 0, f"{TAG}\trefs/tags/v1.0.0\n", ""),
                ],
            ),
            patch.object(release, "git", return_value=TAG),
            patch.object(publisher, "tag_provenance"),
        ):
            publisher.ensure_tag("1.0.0", pr(), MERGE, HEAD, None, False)

    def test_prepare_publish_interrupted_draft_and_completed_recovery(self):
        publisher = self.publisher()
        approved = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
        state = Lifecycle()
        with (
            patch.object(release, "git", side_effect=state.git),
            patch.object(release, "command", side_effect=state.command),
            patch.object(release, "api", side_effect=state.api),
            patch.object(release, "ancestor", return_value=True),
            patch.object(publisher, "promotion_base", return_value=BASE),
            patch.object(
                release, "changelog", side_effect=lambda ref: CHANGELOG if ref == BASE else approved
            ),
        ):
            candidate = publisher.prepare("1.0.0")
            with self.assertRaisesRegex(release.ReleaseError, "interrupted"):
                publisher.release("1.0.0", candidate)
            self.assertTrue(state.tag)
            self.assertTrue(state.item["draft"])
            publisher.release("1.0.0", publisher.prepare("1.0.0"))
            self.assertFalse(state.item["draft"])
            checks_before = state.check_count
            writes_before = state.write_count
            publisher.release("1.0.0", publisher.prepare("1.0.0"))
            self.assertEqual(state.check_count, checks_before)
            self.assertEqual(state.write_count, writes_before)


class GitMergeTests(unittest.TestCase):
    """Exercise the real Git ancestry, trees and changelog promotion."""

    @staticmethod
    def tree(text):
        blob = release.command(["git", "hash-object", "-w", "--stdin"], input_text=text)
        tree = release.command(
            ["git", "mktree"],
            input_text=f"100644 blob {blob.stdout.strip()}\tCHANGELOG.md\n",
        )
        return tree.stdout.strip()

    @staticmethod
    def commit(tree, message, *parents):
        args = ["git", "commit-tree", tree]
        for parent in parents:
            args.extend(["-p", parent])
        return release.command(args, input_text=message).stdout.strip()

    def test_real_merge_squash_rebase_and_same_head(self):
        identity = {
            "GIT_AUTHOR_NAME": "Fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
            "GIT_COMMITTER_NAME": "Fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        }
        with patch.dict(os.environ, {**ENV, **identity}):
            base_tree = self.tree(CHANGELOG)
            promoted = release.promote("1.0.0", "2026-11-27", CHANGELOG, [])
            promoted_tree = self.tree(promoted)
            base = self.commit(base_tree, "base")
            intermediate = self.commit(base_tree, "candidate first commit", base)
            head = self.commit(promoted_tree, "promote", intermediate)
            replayed = self.commit(base_tree, "rebased first commit", base)
            cases = {
                "merge": self.commit(promoted_tree, "merge", base, head),
                "squash": self.commit(promoted_tree, "squash", base),
                "rebase": self.commit(promoted_tree, "rebased promotion", replayed),
                "same-head": head,
            }
            publisher = release.Publisher()
            real_git = release.git

            def git(*args):
                if args[0] == "fetch":
                    return ""
                if args == ("rev-parse", "refs/remotes/release-pr/42"):
                    return head
                return real_git(*args)

            for strategy, merge in cases.items():
                candidate = pr()
                candidate["head"]["sha"] = head
                candidate["merge_commit_sha"] = merge
                with (
                    self.subTest(strategy=strategy),
                    patch.object(release, "git", side_effect=git),
                    patch.object(publisher, "main", return_value=merge),
                    patch.object(publisher, "tags", return_value=[]),
                    patch.object(
                        release,
                        "pages",
                        return_value=[{"filename": "CHANGELOG.md", "status": "modified"}],
                    ),
                    patch.object(release, "check_pages", return_value=[
                        {**row, "head_sha": head} for row in checks()
                    ]),
                ):
                    self.assertEqual(publisher.merged(candidate, "1.0.0")[:2], (merge, head))
            different = self.commit(self.tree(promoted + "\nUnexpected.\n"), "different", base)
            candidate["merge_commit_sha"] = different
            with (
                patch.object(release, "git", side_effect=git),
                patch.object(publisher, "main", return_value=different),
                patch.object(publisher, "verify_pr", return_value=head),
                self.assertRaisesRegex(release.ReleaseError, "tree"),
            ):
                publisher.merged(candidate, "1.0.0")
            candidate["merge_commit_sha"] = cases["squash"]
            with (
                patch.object(release, "git", side_effect=git),
                patch.object(publisher, "main", return_value=base),
                patch.object(publisher, "verify_pr", return_value=head),
                self.assertRaisesRegex(release.ReleaseError, "not on main"),
            ):
                publisher.merged(candidate, "1.0.0")


if __name__ == "__main__":
    unittest.main()
