"""Regression tests for scripts/release/check_import_integrity.py.

INSTRUCTION-175 Task 5: nine test cases verifying the relative-import
resolution, the SOURCE_SHIP_PATHS class split (whole-tree vs init-only),
and the walk-alignment with public-exclusions.manifest.

Each test constructs a synthetic qsh-like file tree under pytest's
``tmp_path`` fixture, populates the appropriate compile-list/source-ship
sets, and calls ``check_import_integrity.check_tree`` directly. Synthetic
trees keep the fixtures self-contained and avoid coupling the suite to
the real qsh tree's evolving import graph.
"""
from __future__ import annotations

import pathlib
import sys
import textwrap
from typing import Dict, Iterable, List, Set, Tuple

import pytest


_THIS_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS_DIR))

import check_import_integrity as cii  # noqa: E402


def _build_tree(
    tmp_path: pathlib.Path, files: Dict[str, str]
) -> Tuple[pathlib.Path, pathlib.Path]:
    """Construct a synthetic package tree under ``tmp_path``.

    ``files`` maps package-root-relative paths (e.g. ``"qsh/hw_aware.py"``)
    to file contents. ``qsh/__init__.py`` is created automatically as an
    empty file if not supplied. Returns (package_root, qsh_root).
    """
    qsh_root = tmp_path / "qsh"
    qsh_root.mkdir(parents=True, exist_ok=True)
    if "qsh/__init__.py" not in files:
        (qsh_root / "__init__.py").write_text("")
    for rel, content in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content))
    return tmp_path, qsh_root


def _run_check(
    package_root: pathlib.Path,
    qsh_root: pathlib.Path,
    compile_list: Iterable[str] = (),
    whole_tree: Iterable[str] = ("qsh", "qsh.__main__", "qsh.drivers", "qsh.api"),
    init_only: Iterable[str] = (
        "qsh.occupancy",
        "qsh.pipeline",
        "qsh.pipeline.controllers",
        "qsh.tariff",
    ),
    exclusion_patterns: Iterable[str] = (),
    extra_excluded_dirs: Iterable[str] = ("test",),
) -> Tuple[List[Tuple[str, int, str, str]], int]:
    """Thin wrapper around ``check_tree`` that fixes the parameter contract."""
    return cii.check_tree(
        qsh_root=qsh_root,
        package_root=package_root,
        compile_list_entries=set(compile_list),
        whole_tree_paths=set(whole_tree),
        init_only_paths=set(init_only),
        exclusion_patterns=list(exclusion_patterns),
        extra_excluded_dirs=set(extra_excluded_dirs),
        repo_root=package_root,
    )


# ---------------------------------------------------------------------------
# T5.1 — Negative regression for the v1.2.13-shape defect (relative imports
# now resolved instead of unconditionally exempted).
# ---------------------------------------------------------------------------
def test_negative_regression_v1_2_13(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/hw_aware.py": "from .foo import bar\n",
        },
    )

    violations, total_refs = _run_check(package_root, qsh_root)

    assert total_refs >= 1
    targets = [v[2] for v in violations]
    assert "qsh.foo.bar" in targets, (
        f"expected qsh.foo.bar to be flagged, got violations={violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.2 — Positive regression: relative-import resolution must accept legal
# attribute imports off an init-only-ship package's __init__.py.
# ---------------------------------------------------------------------------
def test_positive_regression_v1_2_13(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/pipeline/__init__.py": (
                "from .controllers import HWController\n"
            ),
            "qsh/pipeline/controllers/__init__.py": (
                "class HWController:\n    pass\n"
            ),
        },
    )

    violations, _ = _run_check(package_root, qsh_root)

    assert violations == [], (
        f"expected no violations for attribute import off shipped __init__, "
        f"got {violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.3 — T-23 absolute-import pin: existing rule must continue to PASS.
# Pins INSTRUCTION-133's qsh.config_io regression test.
# ---------------------------------------------------------------------------
def test_t23_absolute_import_pin_v1_2_7(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/main.py": "from qsh.config_io import load_config\n",
            "qsh/config_io.py": "def load_config():\n    pass\n",
        },
    )

    violations, _ = _run_check(
        package_root, qsh_root, compile_list=["qsh.config_io"]
    )

    assert violations == [], (
        f"absolute-import resolution regressed: got {violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.4 — Init-only ship path does NOT grant legality to a sub-MODULE that
# is missing from the compile list. Defect 3B fix verification.
# ---------------------------------------------------------------------------
def test_init_only_ship_does_not_grant_subattr(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/main.py": (
                "from qsh.pipeline.controllers.tariff_optimiser "
                "import TariffOptimiser\n"
            ),
            "qsh/pipeline/controllers/__init__.py": "",
            "qsh/pipeline/controllers/tariff_optimiser.py": (
                "class TariffOptimiser:\n    pass\n"
            ),
        },
    )

    violations, _ = _run_check(
        package_root,
        qsh_root,
        compile_list=[],
    )

    targets = [v[2] for v in violations]
    assert any(
        t.startswith("qsh.pipeline.controllers.tariff_optimiser") for t in targets
    ), (
        f"expected a qsh.pipeline.controllers.tariff_optimiser.* violation, "
        f"got {violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.5 — Multi-dotted relative import surfaces v1.3.2 Failure 2 surface
# (production controller reaching into qsh.twin.*).
# ---------------------------------------------------------------------------
def test_double_dotted_relative_v1_3_2(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/pipeline/controllers/__init__.py": "",
            "qsh/pipeline/controllers/tariff_optimiser.py": (
                "from ...twin.trajectory import project_trajectory\n"
            ),
        },
    )

    violations, _ = _run_check(
        package_root,
        qsh_root,
        compile_list=["qsh.pipeline.controllers.tariff_optimiser"],
    )

    targets = [v[2] for v in violations]
    assert "qsh.twin.trajectory.project_trajectory" in targets, (
        f"expected qsh.twin.trajectory.project_trajectory to be flagged, "
        f"got {violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.6 — Walk alignment: rsync-excluded dev-only files must not be flagged
# even if they contain deliberate violations.
# ---------------------------------------------------------------------------
def test_walk_alignment_excludes_dev_only(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/twin/__init__.py": "",
            "qsh/twin/internal_only.py": (
                "from qsh.totally_made_up_module import nothing\n"
            ),
        },
    )

    violations, _ = _run_check(
        package_root,
        qsh_root,
        exclusion_patterns=["twin/", "twin/**"],
    )

    assert violations == [], (
        f"twin/ files should be excluded from walk, got {violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.7 — Walk alignment: shipped files with deliberate violations MUST be
# flagged. Companion to T5.6.
# ---------------------------------------------------------------------------
def test_walk_alignment_includes_shipped(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/main.py": "from qsh.totally_made_up_module import nothing\n",
        },
    )

    violations, _ = _run_check(
        package_root,
        qsh_root,
        exclusion_patterns=["twin/", "twin/**"],
    )

    targets = [v[2] for v in violations]
    assert "qsh.totally_made_up_module.nothing" in targets, (
        f"shipped main.py with bad import must be flagged, got {violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.8 — Malformed relative import (level exceeds available parent
# packages) must be reported, not silently skipped.
# ---------------------------------------------------------------------------
def test_malformed_relative_import(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/__init__.py": "from ... import bar\n",
        },
    )

    violations, _ = _run_check(package_root, qsh_root)

    targets = [v[2] for v in violations]
    assert any("malformed-relative" in t for t in targets), (
        f"expected a malformed-relative violation, got {violations!r}"
    )


# ---------------------------------------------------------------------------
# T5.9 — `from qsh import X` shape (V2 Finding 6) is preserved: when X is
# a compile-list entry, the import resolves cleanly.
# ---------------------------------------------------------------------------
def test_bare_qsh_attr_compiled_passes(tmp_path: pathlib.Path) -> None:
    package_root, qsh_root = _build_tree(
        tmp_path,
        {
            "qsh/X.py": "from qsh import Y\n",
            "qsh/Y.py": "Y = 1\n",
        },
    )

    violations, _ = _run_check(
        package_root, qsh_root, compile_list=["qsh.X", "qsh.Y"]
    )

    assert violations == [], (
        f"`from qsh import Y` (compile-list entry) regressed: {violations!r}"
    )
