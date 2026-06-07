"""TASK-6: verify build:wasm script and WASM output artifacts."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # repo root


def test_build_wasm_script_exists():
    """AC #1: a 'build:wasm' entry exists under scripts in web/package.json."""
    pkg = json.loads((ROOT / "web" / "package.json").read_text())
    assert "build:wasm" in pkg["scripts"], (
        "'build:wasm' missing from web/package.json scripts"
    )


def test_build_wasm_script_command():
    """AC #1: the build:wasm command matches the plan."""
    pkg = json.loads((ROOT / "web" / "package.json").read_text())
    expected = (
        "wasm-pack build ../crates/gql-core --target web "
        "--out-dir ../web/src/wasm"
    )
    assert pkg["scripts"]["build:wasm"] == expected, (
        f"Expected '{expected}', got '{pkg['scripts']['build:wasm']}'"
    )


def test_build_wasm_produces_artifacts():
    """AC #2: running build:wasm produces gql_core.js and a .wasm file in web/src/wasm/."""
    out_dir = ROOT / "web" / "src" / "wasm"

    result = subprocess.run(
        [
            "pnpm",
            "build:wasm",
        ],
        cwd=ROOT / "web",
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, (
        f"build:wasm failed (rc={result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )

    # gql_core.js must exist
    js_file = out_dir / "gql_core.js"
    assert js_file.exists(), f"Expected {js_file} to exist after build"

    # At least one .wasm file must exist in the output directory
    wasm_files = list(out_dir.glob("*.wasm"))
    assert len(wasm_files) >= 1, (
        f"Expected at least one .wasm file in {out_dir}, found: {wasm_files}"
    )


def test_wasm_output_is_gitignored():
    """AC #3: generated wasm files remain git-ignored (not staged)."""
    gitignore = (ROOT / ".gitignore").read_text()
    assert "web/src/wasm/" in gitignore, (
        "'web/src/wasm/' not found in .gitignore — generated WASM files "
        "would be tracked by git"
    )
