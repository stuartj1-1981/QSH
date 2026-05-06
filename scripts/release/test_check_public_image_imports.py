"""Regression tests for scripts/release/check_public_image_imports.py.

INSTRUCTION-180 Task 3: six test cases verifying the PR-time public-image
deep-import CI gate (CAPA-E).

Each test constructs a synthetic qsh-like file tree under pytest's tmp_path
fixture and calls the gate's helper functions directly. Synthetic trees keep
the fixtures self-contained and avoid coupling the suite to the real qsh
tree's evolving import graph.

Test cases:
  T1 — clean synthetic tree passes (no excluded imports).
  T2 — T-31 violation (production code imports from excluded namespace) fails.
  T3 — dependency missing from tmpdir (simulating compile-list omission) fails.
  T4 — init-only-ship package without __init__.py fails.
  T5 — --verbose flag produces per-module PASS/FAIL output.
  T6 — qsh.main importing excluded namespace surfaces qsh.main in failures.
"""
from __future__ import annotations

import sys
import textwrap
from pathlib import Path
from typing import Dict, List

import pytest

_THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS_DIR))

import check_public_image_imports as cpii  # noqa: E402


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _write_tree(root: Path, files: Dict[str, str]) -> None:
    """Write a dict of path → content into root, creating parents as needed."""
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content))


def _run_gate(
    source_qsh: Path,
    modules: List[str],
    patterns: List[str],
    tmpdir: Path,
    verbose: bool = False,
) -> List[tuple]:
    """Thin wrapper: construct tmpdir mirror then attempt imports."""
    cpii.construct_public_image_tmpdir(tmpdir, patterns, source_qsh=source_qsh)
    return cpii.attempt_imports(tmpdir, modules, verbose)


# ---------------------------------------------------------------------------
# T1 — Clean synthetic tree passes
# ---------------------------------------------------------------------------
def test_t1_clean_tree_passes(tmp_path: Path) -> None:
    """A qsh tree with no excluded-namespace imports must produce no failures."""
    src = tmp_path / "src_qsh"
    _write_tree(src, {
        "__init__.py": "",
        "main.py": "ANSWER = 42\n",
        "utils.py": "from qsh.main import ANSWER\n",
    })

    modules = ["qsh.utils"]
    patterns: List[str] = []
    tmpdir = tmp_path / "mirror"
    tmpdir.mkdir()

    failures = _run_gate(src, modules, patterns, tmpdir)
    assert failures == [], f"Expected no failures on clean tree, got: {failures!r}"


# ---------------------------------------------------------------------------
# T2 — T-31 violation: production code imports from excluded namespace
# ---------------------------------------------------------------------------
def test_t2_excluded_namespace_import_fails(tmp_path: Path) -> None:
    """A controller importing from qsh.twin (excluded) must cause a FAIL."""
    src = tmp_path / "src_qsh"
    _write_tree(src, {
        "__init__.py": "",
        "main.py": "ANSWER = 42\n",
        "pipeline/__init__.py": "",
        "pipeline/controllers/__init__.py": "",
        # This controller illegally imports from the excluded twin namespace
        "pipeline/controllers/bad_controller.py": (
            "from qsh.twin.trajectory import project_trajectory\n"
            "RESULT = project_trajectory\n"
        ),
        # The twin directory is EXCLUDED — it will not be in the tmpdir
        "twin/__init__.py": "",
        "twin/trajectory.py": "def project_trajectory(): pass\n",
    })

    modules = ["qsh.pipeline.controllers.bad_controller"]
    # Exclude the twin/ subtree (as public-exclusions.manifest does)
    patterns = ["twin/", "twin/**"]
    tmpdir = tmp_path / "mirror"
    tmpdir.mkdir()

    failures = _run_gate(src, modules, patterns, tmpdir)

    assert failures, "Expected a failure due to T-31 violation, got none"
    failed_modules = [f[0] for f in failures]
    assert "qsh.pipeline.controllers.bad_controller" in failed_modules, (
        f"Expected bad_controller in failures, got: {failed_modules!r}"
    )
    # The error must name the missing qsh.twin module
    all_errors = " ".join(f[1] for f in failures)
    assert "qsh.twin" in all_errors, (
        f"Expected 'qsh.twin' in error output, got: {all_errors!r}"
    )


# ---------------------------------------------------------------------------
# T3 — Dependency missing from tmpdir (simulating compile-list omission)
# ---------------------------------------------------------------------------
def test_t3_missing_qsh_dependency_fails(tmp_path: Path) -> None:
    """A module that imports another qsh module absent from the mirror must fail.

    This simulates compile-list omission: the imported module exists in the
    source tree but is excluded from the public image (not compiled, not
    source-shipped), so it is absent from the tmpdir.
    """
    src = tmp_path / "src_qsh"
    _write_tree(src, {
        "__init__.py": "",
        "main.py": "ANSWER = 42\n",
        "good_module.py": "from qsh.missing_helper import helper_fn\n",
        # missing_helper.py exists in source tree but will be excluded
        "missing_helper.py": "def helper_fn(): pass\n",
    })

    modules = ["qsh.good_module"]
    # Exclude the missing_helper module to simulate it not being compiled
    patterns = ["missing_helper.py"]
    tmpdir = tmp_path / "mirror"
    tmpdir.mkdir()

    failures = _run_gate(src, modules, patterns, tmpdir)

    assert failures, (
        "Expected failure when a qsh dependency is absent from the public image"
    )
    failed_modules = [f[0] for f in failures]
    assert "qsh.good_module" in failed_modules, (
        f"Expected good_module in failures, got: {failed_modules!r}"
    )
    all_errors = " ".join(f[1] for f in failures)
    assert "qsh.missing_helper" in all_errors, (
        f"Expected 'qsh.missing_helper' in error output, got: {all_errors!r}"
    )


# ---------------------------------------------------------------------------
# T4 — Init-only-ship package entirely absent from tmpdir fails
# ---------------------------------------------------------------------------
def test_t4_missing_package_init_fails(tmp_path: Path) -> None:
    """A new subpackage excluded from the public image mirror causes ImportError.

    This models the scenario where a new package (e.g. qsh.projection) is
    added but the release-sync whitelist is missing the entry, so NO files
    from that package (neither __init__.py nor any compiled modules) end up
    in the public image.  Any production module that imports from the new
    package will then fail at runtime.
    """
    src = tmp_path / "src_qsh"
    _write_tree(src, {
        "__init__.py": "",
        "main.py": "ANSWER = 42\n",
        # new_pkg exists in source but will be wholly excluded from the mirror
        "new_pkg/__init__.py": "# new package\n",
        "new_pkg/helpers.py": "def do_something(): return 1\n",
        # good_module imports from new_pkg — this will fail when new_pkg is absent
        "good_module.py": "from qsh.new_pkg.helpers import do_something\n",
    })

    modules = ["qsh.good_module"]
    # Exclude the entire new_pkg directory (simulating whitelist omission)
    patterns = ["new_pkg/", "new_pkg/**"]
    tmpdir = tmp_path / "mirror"
    tmpdir.mkdir()

    failures = _run_gate(src, modules, patterns, tmpdir)

    assert failures, (
        "Expected failure when new_pkg is wholly absent from the public image mirror"
    )
    failed_modules = [f[0] for f in failures]
    assert "qsh.good_module" in failed_modules, (
        f"Expected good_module in failures, got: {failed_modules!r}"
    )
    all_errors = " ".join(f[1] for f in failures)
    assert "qsh.new_pkg" in all_errors, (
        f"Expected 'qsh.new_pkg' in error output, got: {all_errors!r}"
    )


# ---------------------------------------------------------------------------
# T5 — Verbose flag produces per-module PASS/FAIL output
# ---------------------------------------------------------------------------
def test_t5_verbose_flag_produces_output(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    """--verbose mode must print per-module PASS lines for successful imports."""
    src = tmp_path / "src_qsh"
    _write_tree(src, {
        "__init__.py": "",
        "main.py": "MAIN = 1\n",
        "utils.py": "X = 1\n",
        "config.py": "Y = 2\n",
    })

    modules = ["qsh.utils", "qsh.config"]
    patterns: List[str] = []
    tmpdir = tmp_path / "mirror"
    tmpdir.mkdir()

    cpii.construct_public_image_tmpdir(tmpdir, patterns, source_qsh=src)
    failures = cpii.attempt_imports(tmpdir, modules, verbose=True)

    assert failures == [], f"Expected no failures, got: {failures!r}"

    captured = capsys.readouterr()
    # Verbose output must contain PASS lines for at least one module
    assert "PASS:" in captured.out, (
        f"Expected PASS lines in verbose output, got:\n{captured.out}"
    )


# ---------------------------------------------------------------------------
# T6 — qsh.main importing excluded namespace surfaces qsh.main in failures
# ---------------------------------------------------------------------------
def test_t6_qsh_main_excluded_import_surfaces_qsh_main(tmp_path: Path) -> None:
    """If qsh.main itself imports from an excluded namespace, the gate must
    name qsh.main in the failure list — not just the first compile-list module.
    """
    src = tmp_path / "src_qsh"
    _write_tree(src, {
        "__init__.py": "",
        # qsh.main directly imports from twin (excluded)
        "main.py": "from qsh.twin.trajectory import project_trajectory\n",
        "twin/__init__.py": "",
        "twin/trajectory.py": "def project_trajectory(): pass\n",
        "utils.py": "X = 1\n",
    })

    modules = ["qsh.utils"]
    patterns = ["twin/", "twin/**"]
    tmpdir = tmp_path / "mirror"
    tmpdir.mkdir()

    failures = _run_gate(src, modules, patterns, tmpdir)

    assert failures, "Expected a failure because qsh.main imports from excluded twin"
    failed_modules = [f[0] for f in failures]
    assert "qsh.main" in failed_modules, (
        f"Expected qsh.main in failures (gate tests main first), got: {failed_modules!r}"
    )
    all_errors = " ".join(f[1] for f in failures)
    assert "qsh.twin" in all_errors, (
        f"Expected 'qsh.twin' named in error output, got: {all_errors!r}"
    )
