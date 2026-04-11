#!/usr/bin/env python3
import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request


GALLERY_API_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1"


def read_json(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_newlines(value: str) -> str:
    return value.replace("\r\n", "\n").strip()


def changelog_version_heading(expected_version: str) -> str:
    return f"## v{expected_version} - "


def changelog_section(changelog_text: str, expected_version: str) -> str:
    normalized = normalize_newlines(changelog_text)
    lines = normalized.split("\n")
    heading_prefix = changelog_version_heading(expected_version)
    section_start = -1

    for index, line in enumerate(lines):
        if line.startswith(heading_prefix):
            section_start = index
            break

    if section_start < 0:
        raise RuntimeError(f"Marketplace changelog does not contain a section for version {expected_version}.")

    section_end = len(lines)
    for index in range(section_start + 1, len(lines)):
        if lines[index].startswith("## "):
            section_end = index
            break

    return "\n".join(lines[section_start:section_end]).strip()


def gallery_query(query_url: str, extension_identifier: str):
    body = {
        "filters": [
            {
                "criteria": [
                    {"filterType": 7, "value": extension_identifier},
                ],
                "pageNumber": 1,
                "pageSize": 1,
                "sortBy": 0,
                "sortOrder": 0,
            }
        ],
        "assetTypes": [],
        "flags": 914,
    }

    request = urllib.request.Request(
        query_url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json;api-version=7.2-preview.1",
            "X-Market-Client-Id": "better-todo-tree-release-verifier",
        },
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def find_extension(payload):
    results = payload.get("results", [])
    if not results:
        raise RuntimeError("Marketplace query returned no results.")

    extensions = results[0].get("extensions", [])
    if not extensions:
        raise RuntimeError("Marketplace query returned no extensions.")

    return extensions[0]


def changelog_asset_url(extension, expected_version: str):
    for version in extension.get("versions", []):
        if version.get("version") != expected_version:
            continue

        for file_info in version.get("files", []):
            if file_info.get("assetType") == "Microsoft.VisualStudio.Services.Content.Changelog":
                return file_info.get("source")

    raise RuntimeError(f"No changelog asset was found for version {expected_version}.")


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode("utf-8")


def expected_targets(targets_path: pathlib.Path):
    return set(read_json(targets_path))


def published_targets(extension, expected_version: str):
    return {
        version.get("targetPlatform", "")
        for version in extension.get("versions", [])
        if version.get("version") == expected_version
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--package-json", default="package.json")
    parser.add_argument("--targets", default="scripts/release/targets.json")
    parser.add_argument("--expected-changelog", required=True)
    parser.add_argument("--query-url", default=GALLERY_API_URL)
    parser.add_argument("--interval-seconds", type=int, default=15)
    parser.add_argument("--timeout-seconds", type=int, default=600)
    args = parser.parse_args()

    package_json = read_json(pathlib.Path(args.package_json))
    extension_identifier = f"{package_json['publisher']}.{package_json['name']}"
    expected_version = args.tag.removeprefix("v")
    expected_description = package_json["description"]
    expected_target_set = expected_targets(pathlib.Path(args.targets))
    expected_changelog = pathlib.Path(args.expected_changelog).read_text(encoding="utf-8")
    expected_changelog_section = changelog_section(expected_changelog, expected_version)

    deadline = time.monotonic() + args.timeout_seconds
    last_error = "Marketplace verification did not start."

    while time.monotonic() < deadline:
        try:
            payload = gallery_query(args.query_url, extension_identifier)
            extension = find_extension(payload)

            if extension.get("shortDescription") != expected_description:
                raise RuntimeError(
                    f"Marketplace short description mismatch. Expected '{expected_description}', got '{extension.get('shortDescription', '')}'."
                )

            visible_targets = published_targets(extension, expected_version)
            missing_targets = sorted(expected_target_set - visible_targets)
            if missing_targets:
                raise RuntimeError(
                    f"Marketplace version {expected_version} is still missing target platforms: {', '.join(missing_targets)}."
                )

            changelog_url = changelog_asset_url(extension, expected_version)
            published_changelog = fetch_text(changelog_url)
            published_changelog_section = changelog_section(published_changelog, expected_version)
            if published_changelog_section != expected_changelog_section:
                raise RuntimeError(
                    "Marketplace changelog section does not match the expected generated section "
                    f"for version {expected_version}."
                )

            print(f"Marketplace version {expected_version} is publicly available for {extension_identifier}.")
            print(f"Verified target platforms: {', '.join(sorted(visible_targets))}")
            print(f"Verified short description: {expected_description}")
            print(f"Verified changelog asset: {changelog_url}")
            return 0
        except (RuntimeError, urllib.error.URLError, TimeoutError) as exc:
            last_error = str(exc)
            time.sleep(args.interval_seconds)

    print(last_error, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
