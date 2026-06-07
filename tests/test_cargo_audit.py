"""Audit tests: verify Cargo.toml changes stay scoped to the task."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # repo root


def read_dependencies(path: str) -> dict[str, str]:
    """Return [dependencies] section as {name: value_string}."""
    content = (ROOT / path).read_text()
    in_deps = False
    deps: dict[str, str] = {}
    for line in content.splitlines():
        trimmed = line.strip()
        if trimmed == "[dependencies]":
            in_deps = True
            continue
        if trimmed.startswith("[") and not trimmed.startswith("[package"):
            if in_deps:
                break
        if in_deps and (trimmed.startswith("#") or not trimmed):
            continue
        if in_deps and "=" in trimmed:
            key, value = trimmed.split("=", 1)
            deps[key.strip()] = value.strip()
    return deps


def read_committed_dependencies() -> dict[str, str]:
    """Get [dependencies] from the HEAD commit of Cargo.toml."""
    result = subprocess.run(
        ["git", "show", "HEAD:crates/gql-core/Cargo.toml"],
        capture_output=True,
        check=True,
    )
    content = result.stdout.decode()
    in_deps = False
    deps: dict[str, str] = {}
    for line in content.splitlines():
        trimmed = line.strip()
        if trimmed == "[dependencies]":
            in_deps = True
            continue
        if trimmed.startswith("[") and not trimmed.startswith("[package"):
            if in_deps:
                break
        if in_deps and (trimmed.startswith("#") or not trimmed):
            continue
        if in_deps and "=" in trimmed:
            key, value = trimmed.split("=", 1)
            deps[key.strip()] = value.strip()
    return deps


def test_getrandom_is_the_only_dependency_change():
    """AC #3: the getrandom line is the ONLY dependency change made."""
    committed = read_committed_dependencies()
    working = read_dependencies("crates/gql-core/Cargo.toml")

    changed: set[str] = set()

    for key, value in working.items():
        if key not in committed or committed[key] != value:
            changed.add(key)

    for key in committed:
        if key not in working:
            changed.add(key)

    unexpected = sorted(k for k in changed if k != "getrandom")
    assert (
        not unexpected
    ), f"Unexpected dependency changes beyond 'getrandom': {unexpected}"


if __name__ == "__main__":
    test_getrandom_is_the_only_dependency_change()
    print("PASS: getrandom is the only dependency change")
