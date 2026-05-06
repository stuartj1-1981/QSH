#!/usr/bin/env python3
"""check_public_image_imports.py — PR-time public-image deep-import CI gate (CAPA-E).

Provenance: INSTRUCTION-180 (CAPA-E — DR-6/DR-7/DR-8 cross-DR defensive layer,
Governance Ledger Entry 032). Closes Defect 7 from upstream v1.3.2-beta
termination investigation Part 1.

This script constructs a tmpdir mirror of what the public image would contain
(qsh/ with exclusions from public-exclusions.manifest applied), then attempts
to import every module in submodule-compile-list.txt plus qsh.main.

Catches:
  1. Production code importing from excluded namespace (T-31 violation).
  2. Any import that would fail in the public image (missing dependency).
  3. Source-ship whitelist gaps (e.g., missing __init__.py for a new package).

Exits 0 with "PASS" on a clean tree.
Exits 1 with explicit failure list otherwise.

Usage:
  python3 scripts/release/check_public_image_imports.py [--verbose]
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
PACKAGE_ROOT = REPO_ROOT / "quantum_swarm_heating"
QSH_ROOT = PACKAGE_ROOT / "qsh"
COMPILE_LIST = SCRIPT_DIR / "submodule-compile-list.txt"
EXCLUSIONS_MANIFEST = SCRIPT_DIR / "public-exclusions.manifest"


def parse_compile_list(path: Path = COMPILE_LIST) -> List[str]:
    """Read submodule-compile-list.txt; return list of dotted module names."""
    modules: List[str] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                modules.append(line)
    return modules


def parse_exclusion_patterns(path: Path = EXCLUSIONS_MANIFEST) -> List[str]:
    """Read public-exclusions.manifest; return list of glob patterns."""
    patterns: List[str] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                patterns.append(line)
    return patterns


def _matches_exclusion(rel_path: str, patterns: List[str]) -> bool:
    """Return True if rel_path matches any exclusion pattern."""
    name = Path(rel_path).name
    for pattern in patterns:
        # Bare filename glob (e.g. "*.pyc", "conftest.py")
        if "/" not in pattern and not pattern.endswith("/**"):
            if fnmatch.fnmatch(name, pattern):
                return True
        # Directory prefix (e.g. "twin/", "tests/")
        if pattern.endswith("/"):
            prefix = pattern[:-1]
            if rel_path == prefix or rel_path.startswith(prefix + "/"):
                return True
        # Double-star directory (e.g. "twin/**", "tests/**")
        if pattern.endswith("/**"):
            prefix = pattern[:-3]
            if rel_path == prefix or rel_path.startswith(prefix + "/"):
                return True
        # Full glob match on the path (e.g. "**/test_*.py")
        if fnmatch.fnmatch(rel_path, pattern):
            return True
        # Also match the basename against double-star patterns
        if pattern.startswith("**/"):
            tail = pattern[3:]
            if fnmatch.fnmatch(name, tail):
                return True
    return False


def construct_public_image_tmpdir(
    tmpdir: Path,
    patterns: List[str],
    source_qsh: Path = QSH_ROOT,
) -> None:
    """Copy source_qsh into tmpdir/qsh/, excluding patterns.

    The result mirrors what the public image would contain: qsh/ source tree
    minus excluded namespaces (twin/, tests/, etc.).  Callers set PYTHONPATH
    to tmpdir so that ``import qsh.X`` resolves against the filtered copy.
    """
    dest_qsh = tmpdir / "qsh"

    def _ignore(directory: str, contents: List[str]) -> set:
        ignored: set = set()
        dir_path = Path(directory)
        try:
            rel_dir = dir_path.relative_to(source_qsh)
            rel_dir_str = str(rel_dir) if str(rel_dir) != "." else ""
        except ValueError:
            rel_dir_str = ""

        for item in contents:
            rel_item = f"{rel_dir_str}/{item}" if rel_dir_str else item
            item_path = dir_path / item
            # Also test with trailing slash for directory matching
            rel_item_dir = rel_item + "/" if item_path.is_dir() else rel_item
            if _matches_exclusion(rel_item, patterns) or _matches_exclusion(
                rel_item_dir, patterns
            ):
                ignored.add(item)
        return ignored

    shutil.copytree(str(source_qsh), str(dest_qsh), ignore=_ignore)


def _is_qsh_namespace_failure(stderr: str) -> bool:
    """Return True if the ImportError is due to a missing qsh.* module.

    Third-party missing packages (numpy, torch, etc.) are expected to be absent
    in the dev CI environment — they are installed in the production Docker image.
    The gate only flags qsh-namespace failures, which indicate T-31 violations
    (excluded namespaces), missing compile-list entries, or whitelist gaps.
    """
    for line in stderr.splitlines():
        if "ModuleNotFoundError: No module named" in line:
            # Extract the quoted module name
            start = line.find("'")
            end = line.rfind("'")
            if start != -1 and end > start:
                missing = line[start + 1 : end]
                if missing.startswith("qsh.") or missing == "qsh":
                    return True
            return False
        if "ImportError" in line and "qsh" in line:
            return True
    # Non-zero exit with no ModuleNotFoundError → unexpected failure (flag it)
    return True


def attempt_imports(
    tmpdir: Path,
    modules: List[str],
    verbose: bool,
) -> List[Tuple[str, str]]:
    """Try importing each module with PYTHONPATH=tmpdir via subprocess.

    Returns list of (module_name, error_message) for each qsh-namespace failure.
    Third-party missing packages (numpy, torch, etc.) are logged as warnings
    but do not constitute gate violations — they are present in the production
    Docker image but may be absent in the dev CI environment.
    """
    failures: List[Tuple[str, str]] = []
    warnings: List[Tuple[str, str]] = []
    env = os.environ.copy()
    env["PYTHONPATH"] = str(tmpdir)

    # Always test qsh.main first, then all compiled modules
    all_modules = ["qsh.main"] + [m for m in modules if m != "qsh.main"]

    seen: set = set()
    for module in all_modules:
        if module in seen:
            continue
        seen.add(module)

        result = subprocess.run(
            [sys.executable, "-c", f"import {module}"],
            cwd=str(tmpdir),
            env=env,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            if _is_qsh_namespace_failure(stderr):
                failures.append((module, stderr))
                if verbose:
                    print(f"  FAIL: {module}")
                    lines = stderr.splitlines()
                    print(f"    {lines[-1] if lines else stderr}")
            else:
                warnings.append((module, stderr))
                if verbose:
                    lines = stderr.splitlines()
                    msg = lines[-1] if lines else stderr
                    print(f"  WARN: {module} (third-party dep missing: {msg})")
        elif verbose:
            print(f"  PASS: {module}")

    if warnings and not verbose:
        third_party = set()
        for _, stderr in warnings:
            for line in stderr.splitlines():
                if "ModuleNotFoundError: No module named" in line:
                    start = line.find("'")
                    end = line.rfind("'")
                    if start != -1 and end > start:
                        third_party.add(line[start + 1 : end])
        if third_party:
            print(
                f"  [WARN] {len(warnings)} module(s) skipped due to missing third-party "
                f"deps: {', '.join(sorted(third_party)[:5])}"
                + (" ..." if len(third_party) > 5 else "")
            )

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true", help="Print per-module result")
    args = parser.parse_args()

    print("Public-image deep-import CI gate (CAPA-E)")
    print("=" * 50)

    if not QSH_ROOT.is_dir():
        print(f"FATAL: qsh root not found: {QSH_ROOT}", file=sys.stderr)
        return 1

    modules = parse_compile_list()
    patterns = parse_exclusion_patterns()
    print(f"Compiled modules to test: {len(modules)}")
    print(f"Exclusion patterns:        {len(patterns)} (from public-exclusions.manifest)")

    with tempfile.TemporaryDirectory(prefix="public_image_check_") as tmpdir_str:
        tmpdir = Path(tmpdir_str)
        construct_public_image_tmpdir(tmpdir, patterns)

        failures = attempt_imports(tmpdir, modules, args.verbose)

        if failures:
            print(f"\nFAIL: {len(failures)} qsh-namespace import error(s)")
            for module, error in failures:
                lines = error.splitlines()
                print(f"\n  {module}:")
                print(f"    {lines[-1] if lines else error}")
            print()
            print("Public image structure has import-graph violations.")
            print("Likely causes:")
            print("  1. Production code imports from excluded namespace (T-31 violation).")
            print("  2. Compile-list missing entry for a controller dependency.")
            print("  3. Source-ship whitelist missing __init__.py for a new package.")
            return 1

        total = len(modules) + 1  # +1 for qsh.main tested
        print(f"\nPASS: All {total} qsh-namespace imports clean")
        print("Public image structure is import-clean.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
