#!/usr/bin/env python3
"""Prepare and publish a human-reviewed, changelog-only release."""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

REPOSITORY = "basil-one/agency"
CHECKS = (
    "Common: Code Quality",
    "Common: Coherence Integrity",
    "Common: Dependency Security",
    "Site: Build Integrity",
    "Site: Link Integrity",
    "Site: SEO Integrity",
    "Site: Rendering Integrity",
    "Site: Performance Integrity",
)
APP_ID = 15368
SHA = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")
HEADING = re.compile(r"^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$", re.M)


class ReleaseError(RuntimeError):
    """Evidence is incomplete or inconsistent."""


class ChecksPending(ReleaseError):
    """Required checks have not finished reporting."""


def version_tuple(version):
    match = VERSION.fullmatch(version)
    if not match:
        raise ReleaseError("Version must be stable X.Y.Z without a v prefix.")
    return tuple(map(int, match.groups()))


def command(args, *, input_text=None, allow_failure=False):
    result = subprocess.run(
        args, input=input_text, text=True, capture_output=True, timeout=120, check=False
    )
    if result.returncode and not allow_failure:
        raise ReleaseError(f"{args[0]} failed: {result.stderr.strip()}")
    return result


def git(*args):
    return command(["git", *args]).stdout.strip()


def ancestor(first, second):
    result = command(["git", "merge-base", "--is-ancestor", first, second], allow_failure=True)
    if result.returncode not in (0, 1):
        raise ReleaseError("Unable to establish commit ancestry.")
    return result.returncode == 0


def api(path, method="GET", data=None):
    args = ["gh", "api", "--method", method, path]
    if data is not None:
        args += ["--input", "-"]
    result = command(args, input_text=json.dumps(data) if data is not None else None)
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        raise ReleaseError(f"Malformed GitHub response for {path}.") from error


def pages(path):
    result = []
    separator = "&" if "?" in path else "?"
    for page in range(1, 101):
        items = api(f"{path}{separator}per_page=100&page={page}")
        if not isinstance(items, list) or len(items) > 100:
            raise ReleaseError("Malformed paginated response.")
        result.extend(items)
        if len(items) < 100:
            return result
    raise ReleaseError("Pagination limit exceeded.")


def check_pages(repo, head):
    path = f"repos/{repo}/commits/{head}/check-runs?filter=all&per_page=100"
    collected = []
    total = None
    for page in range(1, 12):
        data = api(f"{path}&page={page}")
        if not isinstance(data, dict):
            raise ReleaseError("Malformed check response.")
        count, runs = data.get("total_count"), data.get("check_runs")
        if type(count) is not int or count < 0 or count > 1000:
            raise ReleaseError("Check count unavailable or exceeds API limit.")
        if total is not None and count != total:
            raise ReleaseError("Check count changed during pagination.")
        if not isinstance(runs, list) or len(runs) > 100:
            raise ReleaseError("Malformed check page.")
        total = count
        collected.extend(runs)
        if len(collected) > total or (len(collected) < total and len(runs) != 100):
            raise ReleaseError("Incomplete check pages.")
        if len(collected) == total:
            ids = [run.get("id") for run in collected if isinstance(run, dict)]
            if len(ids) != total or any(type(i) is not int or i < 1 for i in ids):
                raise ReleaseError("Malformed check IDs.")
            if len(set(ids)) != len(ids):
                raise ReleaseError("Duplicate check IDs in paginated evidence.")
            return collected
    raise ReleaseError("Incomplete check pages.")


def verify_checks(runs, head):
    latest = {}
    for run in runs:
        identity = check_identity(run, head)
        if identity is None:
            continue
        name, stamp = identity
        old = latest.get(name)
        if old and stamp == old[0] and run["id"] != old[1]["id"]:
            raise ReleaseError(f"Ambiguous check evidence for {name}.")
        if not old or stamp > old[0]:
            latest[name] = (stamp, run)
    for name in CHECKS:
        if name not in latest:
            raise ChecksPending(f"Missing check: {name}.")
        run = latest[name][1]
        if run.get("status") != "completed":
            raise ChecksPending(f"Check is still running: {name}.")
        if run.get("conclusion") != "success":
            raise ReleaseError(f"Check is not successful: {name}.")
    return {name: latest[name][1]["id"] for name in CHECKS}


def check_identity(run, head):
    if not isinstance(run, dict):
        raise ReleaseError("Malformed check.")
    name = run.get("name")
    if name not in CHECKS:
        return None
    app = run.get("app")
    if run.get("head_sha") != head or not isinstance(app, dict) or app.get("id") != APP_ID:
        raise ReleaseError(f"Wrong revision or app for {name}.")
    stamp = run.get("started_at") or run.get("created_at")
    if (
        not isinstance(stamp, str)
        or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", stamp)
        or type(run.get("id")) is not int
        or run["id"] < 1
    ):
        raise ReleaseError(f"Malformed check identity for {name}.")
    if run.get("status") not in ("queued", "in_progress", "completed"):
        raise ReleaseError(f"Malformed check status for {name}.")
    return name, stamp


def changelog_bounds(text):
    lines = text.splitlines(keepends=True)
    indexes = [i for i, line in enumerate(lines) if line.rstrip("\r\n") == "## [Unreleased]"]
    if len(indexes) != 1:
        raise ReleaseError("Expected exactly one Unreleased section.")
    start = indexes[0] + 1
    end = next((i for i in range(start, len(lines)) if lines[i].startswith("## [")), len(lines))
    return lines, start, end


def validate_history(version, day, text, tags):
    try:
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError(day)
    except ValueError as error:
        raise ReleaseError("Invalid release date.") from error
    matches = list(HEADING.finditer(text))
    prior = [version_tuple(m.group(1)) for m in matches]
    tag_versions = [
        version_tuple(t[1:])
        for t in tags
        if VERSION.fullmatch(t.removeprefix("v")) and t.startswith("v")
    ]
    if sorted(prior, reverse=True) != prior or len(set(prior)) != len(prior):
        raise ReleaseError("Changelog versions are out of order or duplicated.")
    if set(prior) != set(tag_versions):
        raise ReleaseError("Stable tags and changelog versions disagree.")
    if prior and version_tuple(version) <= max(prior):
        raise ReleaseError("Version must be newer than the latest release.")
    return matches, prior


def promote(version, day, text, tags):
    version_tuple(version)
    matches, prior = validate_history(version, day, text, tags)
    lines, start, end = changelog_bounds(text)
    # Link definitions belong to the document, not the Unreleased entry.
    while end > start and (not lines[end - 1].strip() or lines[end - 1].startswith("[")):
        end -= 1
    body = "".join(lines[start:end]).strip()
    if not re.search(r"^\s*[-*]\s+\S", body, re.M):
        raise ReleaseError("Unreleased has no entries.")
    promoted = (
        "".join(lines[:start])
        + f"\n## [{version}] - {day}\n\n{body}\n\n"
        + "".join(lines[end:]).lstrip("\n")
    )
    url = f"https://github.com/{REPOSITORY}"
    links = list(re.finditer(r"^\[Unreleased\]: .*$", promoted, re.M))
    if len(links) > 1 or re.search(rf"^\[{re.escape(version)}\]:", promoted, re.M):
        raise ReleaseError("Duplicate changelog links.")
    replacement = f"[Unreleased]: {url}/compare/v{version}...HEAD"
    if prior:
        previous = matches[0].group(1)
        replacement += f"\n[{version}]: {url}/compare/v{previous}...v{version}"
    else:
        replacement += f"\n[{version}]: {url}/releases/tag/v{version}"
    if links:
        promoted = promoted[: links[0].start()] + replacement + promoted[links[0].end() :]
    else:
        promoted = promoted.rstrip() + "\n\n" + replacement + "\n"
    return promoted


def notes(version, text):
    matches = list(HEADING.finditer(text))
    indexes = [index for index, match in enumerate(matches) if match.group(1) == version]
    if len(indexes) != 1:
        raise ReleaseError("Requested changelog entry is missing or duplicated.")
    index = indexes[0]
    end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
    section = text[matches[index].end() : end]
    section = re.split(r"^\[[^]]+\]: ", section, maxsplit=1, flags=re.M)[0].strip()
    if not section:
        raise ReleaseError("Release notes are empty.")
    return section + "\n"


def changelog(revision):
    result = command(["git", "show", f"{revision}:CHANGELOG.md"])
    return result.stdout


def safe_sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ReleaseError("Invalid commit SHA.")
    return value


def verify_linear_merge(base, merge):
    rows = git("rev-list", "--parents", f"{base}..{merge}").splitlines()
    if not rows or len(rows) > 1000:
        raise ReleaseError("Rebased release history is incomplete or too long.")
    expected = merge
    for row in rows:
        commits = row.split()
        if len(commits) != 2 or commits[0] != expected:
            raise ReleaseError("Rebased release history is not linear.")
        changed = git("diff", "--name-only", commits[1], commits[0]).splitlines()
        if any(name != "CHANGELOG.md" for name in changed):
            raise ReleaseError("Rebased release history changes more than CHANGELOG.md.")
        expected = commits[1]
    if expected != base:
        raise ReleaseError("Rebased release history does not reach the reviewed base.")


class Publisher:
    def __init__(self):
        if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
            raise ReleaseError("Unexpected repository.")
        if (
            os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
            or os.environ.get("GITHUB_REF") != "refs/heads/main"
        ):
            raise ReleaseError("Only manual main dispatch can publish.")
        self.repo = REPOSITORY

    def main(self):
        git("fetch", "origin", "+refs/heads/main:refs/remotes/origin/main", "--tags")
        return safe_sha(git("rev-parse", "refs/remotes/origin/main"))

    def tags(self, revision=None):
        args = ["tag", "--list", "v*"]
        if revision:
            args += ["--merged", revision]
        return git(*args).splitlines()

    def pull_requests(self, branch):
        owner = self.repo.split("/")[0]
        items = pages(f"repos/{self.repo}/pulls?state=all&base=main&head={owner}:{branch}")
        if len(items) > 1:
            raise ReleaseError("Multiple release PRs require human reconciliation.")
        if not items:
            return None
        number = items[0].get("number")
        if type(number) is not int or number < 1:
            raise ReleaseError("Invalid PR number.")
        pr = api(f"repos/{self.repo}/pulls/{number}")
        if not isinstance(pr, dict) or pr.get("number") != number:
            raise ReleaseError("Pull request detail does not match the listed PR.")
        return pr

    def verify_pr(self, pr, version):
        branch = f"release/v{version}"
        if not isinstance(pr, dict):
            raise ReleaseError("Malformed PR.")
        head, base = pr.get("head"), pr.get("base")
        if not isinstance(head, dict) or not isinstance(base, dict):
            raise ReleaseError("Malformed PR branches.")
        if not isinstance(head.get("repo"), dict) or not isinstance(base.get("repo"), dict):
            raise ReleaseError("Malformed PR repositories.")
        if (
            type(pr.get("number")) is not int
            or pr["number"] < 1
            or pr.get("title") != f"Prepare Agency release v{version}"
            or head.get("ref") != branch
            or base.get("ref") != "main"
            or head["repo"].get("full_name") != self.repo
            or base["repo"].get("full_name") != self.repo
        ):
            raise ReleaseError("Release PR identity does not match.")
        safe_sha(head.get("sha"))
        files = pages(f"repos/{self.repo}/pulls/{pr['number']}/files")
        if (
            len(files) != 1
            or not isinstance(files[0], dict)
            or files[0].get("filename") != "CHANGELOG.md"
            or files[0].get("status") != "modified"
        ):
            raise ReleaseError("Release PR must modify only CHANGELOG.md.")
        if pr.get("state") == "closed" and not pr.get("merged_at"):
            raise ReleaseError("Release PR closed without merging.")
        if pr.get("state") not in ("open", "closed"):
            raise ReleaseError("Invalid PR state.")
        return head["sha"]

    def verify_promotion(self, head, base, version):
        if not ancestor(base, head):
            raise ReleaseError("Release head is not based on the verified base.")
        if git("diff", "--name-only", base, head).splitlines() != ["CHANGELOG.md"]:
            raise ReleaseError("Release changes more than CHANGELOG.md.")
        actual = changelog(head)
        matches = list(HEADING.finditer(actual))
        if not matches or matches[0].group(1) != version:
            raise ReleaseError("Release version does not match changelog.")
        expected = promote(version, matches[0].group(2), changelog(base), self.tags(base))
        if actual != expected:
            raise ReleaseError("Changelog does not match the exact promotion.")
        return actual

    def promotion_base(self, head, version):
        commits = git("log", "--reverse", "--format=%H", head, "--", "CHANGELOG.md")
        for commit in commits.splitlines():
            if not any(match.group(1) == version for match in HEADING.finditer(changelog(commit))):
                continue
            parents = git("rev-list", "--parents", "-n", "1", commit).split()
            if len(parents) != 2:
                raise ReleaseError("Changelog promotion has no single parent.")
            base = safe_sha(parents[1])
            if any(match.group(1) == version for match in HEADING.finditer(changelog(base))):
                raise ReleaseError("Cannot establish original changelog promotion.")
            return base
        raise ReleaseError("Cannot establish original changelog promotion.")

    def merged_base(self, head, merge, version):
        parents = git("rev-list", "--parents", "-n", "1", merge).split()
        if len(parents) not in (2, 3) or parents[0] != merge:
            raise ReleaseError("Merge parents do not establish the reviewed PR relationship.")
        if len(parents) == 3:
            if parents[2] != head or not ancestor(parents[1], head):
                raise ReleaseError("Merge parents do not establish the reviewed PR relationship.")
            base = parents[1]
        else:
            base = safe_sha(git("merge-base", head, merge))
            if base == head:
                base = self.promotion_base(head, version)
            verify_linear_merge(base, merge)
        return base

    def merged(self, pr, version, *, checks=True):
        head = self.verify_pr(pr, version)
        if pr.get("state") != "closed" or not pr.get("merged_at") or pr.get("merged") is not True:
            raise ReleaseError("Release PR has not been merged.")
        if not isinstance(pr.get("merged_by"), dict) or pr["merged_by"].get("type") != "User":
            raise ReleaseError("Release PR must be merged by a human GitHub user.")
        merge = safe_sha(pr.get("merge_commit_sha"))
        number = pr["number"]
        git("fetch", "origin", f"+refs/pull/{number}/head:refs/remotes/release-pr/{number}")
        if git("rev-parse", f"refs/remotes/release-pr/{number}") != head:
            raise ReleaseError("Fetched PR head differs from checked head.")
        main = self.main()
        if not ancestor(merge, main):
            raise ReleaseError("Merge is not on main.")
        if git("rev-parse", f"{head}^{{tree}}") != git("rev-parse", f"{merge}^{{tree}}"):
            raise ReleaseError("Merged tree differs from the checked head.")
        self.verify_promotion(head, self.merged_base(head, merge, version), version)
        if not checks:
            return merge, head, None
        check_ids = verify_checks(check_pages(self.repo, head), head)
        return merge, head, check_ids

    def reject_competing_prs(self, branch):
        open_prs = pages(f"repos/{self.repo}/pulls?state=open&base=main")
        for item in open_prs:
            if not isinstance(item, dict) or not isinstance(item.get("head"), dict):
                raise ReleaseError("Malformed open PR evidence.")
            other = item["head"].get("ref")
            if not isinstance(other, str):
                raise ReleaseError("Malformed open PR branch.")
            if other.startswith("release/v") and other != branch:
                raise ReleaseError("Another release PR is pending.")

    def validate_previous_releases(self):
        tags = self.tags()
        if not tags:
            return
        published = pages(f"repos/{self.repo}/releases")
        for tag in tags:
            if VERSION.fullmatch(tag.removeprefix("v")):
                found = [item for item in published if item.get("tag_name") == tag]
                if len(found) != 1 or found[0].get("draft") is not False:
                    raise ReleaseError(f"Previous release {tag} is missing or incomplete.")

    def prepare(self, version):
        version_tuple(version)
        main = self.main()
        if git("rev-parse", "HEAD") != main:
            raise ReleaseError("Dispatch revision is not current main; rerun.")
        branch = f"release/v{version}"
        pr = self.pull_requests(branch)
        published = pr and pr.get("state") == "closed" and self.existing_release(f"v{version}")
        if not published or published.get("draft") is not False:
            self.reject_competing_prs(branch)
        if pr:
            head = self.verify_pr(pr, version)
            if pr.get("state") == "open":
                git("fetch", "origin", f"+refs/heads/{branch}:refs/remotes/release-branch")
                if git("rev-parse", "refs/remotes/release-branch") != head or not ancestor(
                    main, head
                ):
                    raise ReleaseError("Release branch is stale or differs from the PR.")
                self.verify_promotion(head, main, version)
            return pr
        remote = git("ls-remote", "--heads", "origin", f"refs/heads/{branch}")
        if f"v{version}" in self.tags():
            raise ReleaseError("Existing tag without a matching PR.")
        if self.existing_release(f"v{version}") is not None:
            raise ReleaseError("Existing release without a matching PR and tag.")
        if remote:
            git("fetch", "origin", f"+refs/heads/{branch}:refs/remotes/release-branch")
            head = safe_sha(git("rev-parse", "refs/remotes/release-branch"))
            self.verify_promotion(head, main, version)
            return self.create_pr(version, branch)
        self.validate_previous_releases()
        promoted = promote(
            version, datetime.now(timezone.utc).date().isoformat(), changelog(main), self.tags()
        )
        git("switch", "--create", branch, main)
        Path("CHANGELOG.md").write_text(promoted, encoding="utf-8")
        git("add", "--", "CHANGELOG.md")
        git(
            "-c",
            "user.name=github-actions[bot]",
            "-c",
            "user.email=41898282+github-actions[bot]@users.noreply.github.com",
            "commit",
            "-m",
            f"Prepare Agency release v{version}",
        )
        git("push", "origin", f"HEAD:refs/heads/{branch}")
        return self.create_pr(version, branch)

    def create_pr(self, version, branch):
        pr = api(
            f"repos/{self.repo}/pulls",
            "POST",
            {
                "title": f"Prepare Agency release v{version}",
                "head": branch,
                "base": "main",
                "body": "Review and merge this changelog-only release PR through the Quality Gate. Approve requested workflow runs if necessary. Rerun Release Publish with the same version to resume.",
            },
        )
        self.verify_pr(pr, version)
        return pr

    def existing_release(self, tag):
        releases = pages(f"repos/{self.repo}/releases")
        if not all(isinstance(item, dict) for item in releases):
            raise ReleaseError("Malformed release evidence.")
        found = [item for item in releases if item.get("tag_name") == tag]
        if len(found) > 1:
            raise ReleaseError("Duplicate releases for tag.")
        return found[0] if found else None

    def tag_provenance(self, tag, merge, head, number, version):
        # This record relies on repository-writer trust, not authenticated authorship.
        if (
            git("rev-parse", f"refs/tags/{tag}^{{commit}}") != merge
            or git("cat-file", "-t", f"refs/tags/{tag}") != "tag"
        ):
            raise ReleaseError("Existing tag does not match verified source.")
        existing = git("for-each-ref", "--format=%(contents)", f"refs/tags/{tag}")
        try:
            title, raw = existing.split("\n", 1)
            recorded = json.loads(raw)
        except (ValueError, IndexError, KeyError, TypeError) as error:
            raise ReleaseError("Existing tag lacks release provenance.") from error
        if (
            title != "Agency Release Publish provenance"
            or not isinstance(recorded, dict)
            or set(recorded) != {"version", "pr", "head", "source"}
            or recorded["version"] != version
            or recorded["pr"] != number
            or recorded["head"] != head
            or recorded["source"] != merge
        ):
            raise ReleaseError("Existing tag provenance does not match release PR.")

    def validate_release(self, item, tag, body):
        if (
            not isinstance(item, dict)
            or item.get("tag_name") != tag
            or item.get("name") != tag
            or item.get("body") != body
            or item.get("prerelease") is not False
            or item.get("assets") != []
            or type(item.get("draft")) is not bool
            or type(item.get("id")) is not int
            or item["id"] < 1
        ):
            raise ReleaseError("Existing release differs from approved publication.")

    def ensure_tag(self, version, pr, merge, head, item, completed):
        tag = f"v{version}"
        source = command(
            ["git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"], allow_failure=True
        )
        remote = command(
            ["git", "ls-remote", "--exit-code", "--refs", "origin", f"refs/tags/{tag}"],
            allow_failure=True,
        )
        if remote.returncode not in (0, 2):
            raise ReleaseError("Unable to inspect the remote release tag.")
        if source.returncode == 0:
            local = git("rev-parse", f"refs/tags/{tag}")
            if remote.returncode != 0 or remote.stdout.strip() != f"{local}\trefs/tags/{tag}":
                raise ReleaseError("Local and remote release tags differ.")
            self.tag_provenance(tag, merge, head, pr["number"], version)
        else:
            if source.returncode != 1 or remote.returncode != 2 or completed or item is not None:
                raise ReleaseError("Release exists without its verified tag.")
            provenance = {
                "version": version,
                "pr": pr["number"],
                "head": head,
                "source": merge,
            }
            message = "Agency Release Publish provenance\n" + json.dumps(provenance, sort_keys=True)
            git(
                "-c",
                "user.name=github-actions[bot]",
                "-c",
                "user.email=41898282+github-actions[bot]@users.noreply.github.com",
                "tag",
                "-a",
                tag,
                merge,
                "-m",
                message,
            )
            git("push", "origin", f"refs/tags/{tag}")

    def release(self, version, pr):
        version_tuple(version)
        number = pr["number"]
        pr = api(f"repos/{self.repo}/pulls/{number}")
        if not isinstance(pr, dict) or pr.get("number") != number:
            raise ReleaseError("Pull request detail does not match the selected PR.")
        tag = f"v{version}"
        item = self.existing_release(tag)
        completed = item is not None and item.get("draft") is False
        merge, head, _ = self.merged(pr, version, checks=not completed)
        main = self.main()
        if not ancestor(merge, main):
            raise ReleaseError("Merge is no longer on main.")
        approved = changelog(merge)
        if not completed and notes(version, changelog(main)) != notes(version, approved):
            raise ReleaseError("Current main changed the release entry.")
        stable = [
            version_tuple(t[1:])
            for t in self.tags()
            if t.startswith("v") and VERSION.fullmatch(t[1:])
        ]
        if not completed and stable and max(stable) > version_tuple(version):
            raise ReleaseError("A newer stable tag exists.")
        body = notes(version, approved)
        if item is not None:
            self.validate_release(item, tag, body)
        self.ensure_tag(version, pr, merge, head, item, completed)
        if item is None:
            item = api(
                f"repos/{self.repo}/releases",
                "POST",
                {
                    "tag_name": tag,
                    "name": tag,
                    "body": body,
                    "draft": True,
                    "prerelease": False,
                },
            )
        self.validate_release(item, tag, body)
        if item["draft"]:
            item = api(f"repos/{self.repo}/releases/{item['id']}", "PATCH", {"draft": False})
            self.validate_release(item, tag, body)
            if item.get("draft") is not False:
                raise ReleaseError("Published release could not be verified.")
        print(f"Published or verified {tag} at {merge}, PR #{pr['number']}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    try:
        publisher = Publisher()
        pr = publisher.prepare(args.version)
        url = f"https://github.com/{publisher.repo}/pull/{pr['number']}"
        print(f"Release PR #{pr['number']}: {url}", flush=True)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary and pr.get("state") == "open":
            with open(summary, "a", encoding="utf-8") as stream:
                print(
                    "## Release Publish: human action\n\n"
                    f"Review {url}, approve checks if prompted, "
                    "and merge through the Quality Gate. Rerun the same version if interrupted.",
                    file=stream,
                )
        deadline = time.monotonic() + 1800
        while True:
            if pr.get("state") == "open":
                print(f"Waiting for PR #{pr['number']}: awaiting human merge.", flush=True)
            else:
                try:
                    publisher.release(args.version, pr)
                    break
                except ChecksPending as error:
                    print(f"Waiting for required checks: {error}", flush=True)
            if time.monotonic() >= deadline:
                raise ReleaseError("Timed out waiting for merge/checks; rerun the same version.")
            time.sleep(60)
            pr = api(f"repos/{publisher.repo}/pulls/{pr['number']}")
            publisher.verify_pr(pr, args.version)
    except (ReleaseError, OSError, subprocess.SubprocessError) as error:
        print(f"Release stopped safely: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
