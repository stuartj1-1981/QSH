#!/usr/bin/env python3
"""check_import_integrity.py — AST import-integrity pre-flight (T-23).

Walks every *.py file under quantum_swarm_heating/qsh/ and verifies that
every import targeting the qsh namespace resolves to either:

  - an entry in scripts/release/submodule-compile-list.txt, OR
  - a documented source-ship path under qsh/ (drivers/, api/, package
    __init__.py files copied by release-sync.sh).

The walk filter is aligned with the rsync exclusion list in
scripts/release/public-exclusions.manifest, which is the single source of
truth for what release-sync.sh ships into the public repo. If you change
either side, change the other.

Exits 0 with "Import integrity OK ..." on a clean tree.
Exits 1 with an explicit violation list otherwise.

Provenance: INSTRUCTION-133 (Tasks 1-2), governance ledger Entry 017,
tenet T-23 (Compile-List Completeness). Refactored by INSTRUCTION-175
to (a) resolve relative imports against the file's parent package,
(b) split SOURCE_SHIP_PATHS into class-distinct sets, (c) align the file
walk with release-sync.sh exclusions.

Implementation notes:
  - Uses ast.parse only — never imports from the project. Usable mid-refactor.
  - Resolution rule (V2 Finding 5): qsh.X.Y.Z resolves iff any NON-BARE prefix
    (qsh.X.Y.Z, qsh.X.Y, qsh.X) is in the legal set. The bare `qsh` package's
    presence is NOT sufficient for sub-attribute references — that was the
    originating bug shape (issue #38).
  - `from qsh import X` shape (V2 Finding 6) is synthesised at collection
    time as `qsh.X` so the resolver checks the actual implied target.
  - Relative imports (`from .x import y`, `from ..x import y`, `from ...x
    import y`) are resolved against the file's parent package and routed
    through the same legal-set predicate. INSTRUCTION-175 Task 2.
  - WHOLE_TREE_SHIP_PATHS vs INIT_ONLY_SHIP_PATHS: an init-only-ship path
    grants legality only to the bare package import target (`from qsh
    import pipeline`), NOT to sub-modules under it (`from qsh.pipeline.X
    import Y`). The latter must be on the compile list. INSTRUCTION-175
    Task 3.
  - Exports _read_compile_list / _write_compile_list for parser-aligned
    negative testing (V2 Finding 8 / Quality Gate #2 of INSTRUCTION-133).
  - Python 3.8+ — no walrus, no match, no sys.stdlib_module_names.
"""
import ast
import pathlib
import sys
from typing import Dict, Iterable, List, Optional, Set, Tuple


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
PACKAGE_ROOT = REPO_ROOT / "quantum_swarm_heating"
QSH_ROOT = PACKAGE_ROOT / "qsh"
COMPILE_LIST = SCRIPT_DIR / "submodule-compile-list.txt"
PUBLIC_EXCLUSION_MANIFEST = SCRIPT_DIR / "public-exclusions.manifest"

# Whole-tree ship paths — release-sync.sh rsyncs the entire subtree at these
# paths into the public repo. A target qsh.<X>.<Y>.<Z> is legal if any prefix
# matches one of these. (release-sync.sh lines 340-351, 354-355.)
WHOLE_TREE_SHIP_PATHS: Set[str] = {
    "qsh",
    "qsh.__main__",
    "qsh.drivers",
    "qsh.api",
}

# Init-only ship paths — release-sync.sh copies ONLY the package __init__.py
# at these paths (Nuitka --module rejects __init__.py — see Ledger Entry 006).
# The bare package name is legal as an import target. Sub-attributes MUST be
# in the compile list — being under an init-only-ship path does NOT grant
# legality to sub-modules. (release-sync.sh lines 365-369.)
# qsh.projection added by INSTRUCTION-179 per T-31 production-code import-graph
# constraint (Governance Ledger Entry 031).
INIT_ONLY_SHIP_PATHS: Set[str] = {
    "qsh.occupancy",
    "qsh.pipeline",
    "qsh.pipeline.controllers",
    "qsh.projection",
    "qsh.tariff",
}

# Extra directories to exclude beyond what the rsync manifest covers.
# `test/` (singular) is a test-fixtures convention used inside qsh/ that does
# not ship via release-sync.sh (only drivers/, api/, and the listed
# __init__.py files are sourced; the rest is compiled or omitted), so its
# imports are out of scope for the integrity gate. The manifest does not
# exclude `test/` because it is not used as a directory name elsewhere; this
# fallback is documented here rather than added to the manifest because a
# manifest change would affect rsync semantics in unrelated paths.
EXTRA_EXCLUDED_DIRS: Set[str] = {"test"}

# Files that release-sync.sh explicitly excludes from the public ship even
# though they live under shipped subtrees (drivers/) or at the top level of
# qsh/. The manifest does not list them — release-sync.sh enforces them via
# direct --exclude flags (mock_driver.py, see release-sync.sh line 343) or
# via not being in any source-ship target (mock_provider.py). They are dev
# fixtures and out of scope for the integrity gate. Per INSTRUCTION-175
# Task 4 fallback: if release-sync.sh's per-target excludes ever change,
# update this set in lockstep. CAPA-E may automate this cross-check.
EXTRA_EXCLUDED_FILE_NAMES: Set[str] = {"mock_provider.py", "mock_driver.py"}


def _read_compile_list(path: pathlib.Path) -> Dict[str, int]:
    """Parse submodule-compile-list.txt → {dotted_name: line_number}.

    Comment lines (leading '#') and blanks are skipped. Insertion order is
    preserved (Python 3.7+) so callers that rewrite the file via
    _write_compile_list keep stable diffs.
    """
    entries: Dict[str, int] = {}
    with path.open() as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            entries[line] = lineno
    return entries


def _write_compile_list(path: pathlib.Path, entries: Dict[str, int]) -> None:
    """Re-write submodule-compile-list.txt from an entries dict.

    Used by INSTRUCTION-133 Quality Gate #2's negative test to mutate the
    list via the same parser the runtime gate uses. Comments are not
    preserved; the test harness restores the original via cp/trap.
    """
    with path.open("w") as fh:
        for name in entries:
            fh.write(f"{name}\n")


def _read_exclusion_manifest(path: pathlib.Path) -> List[str]:
    """Parse public-exclusions.manifest → list of pattern strings.

    Comment lines (leading '#') and blanks are skipped. Patterns are
    returned in source order — order does not matter for the matcher
    semantics but is preserved for ease of debugging.
    """
    patterns: List[str] = []
    if not path.is_file():
        return patterns
    with path.open() as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            patterns.append(line)
    return patterns


def _is_excluded(
    rel_path: pathlib.Path,
    patterns: List[str],
    extra_excluded_dirs: Iterable[str] = (),
    extra_excluded_file_names: Iterable[str] = (),
) -> bool:
    """Return True if rel_path is excluded by any rsync-style pattern.

    Supports the pattern shapes that appear in public-exclusions.manifest:
      - "dir/" or "dir/**"   — exclude if any directory component equals dir
      - "**/glob"            — fnmatch the file name against glob
      - "filename.ext"       — exact filename match anywhere in the tree
      - "*.ext" / "*-ext"    — filename glob match anywhere in the tree

    `extra_excluded_dirs` adds more directory names that are excluded
    beyond the manifest (used for the `test/` fallback per the module
    docstring). `extra_excluded_file_names` adds explicit file-name
    exclusions for files that release-sync.sh removes via direct
    --exclude flags rather than the manifest.
    """
    name = rel_path.name
    parts = rel_path.parts
    parent_parts = parts[:-1]

    for extra_dir in extra_excluded_dirs:
        if extra_dir in parent_parts:
            return True

    for excluded_name in extra_excluded_file_names:
        if name == excluded_name:
            return True

    for raw in patterns:
        pat = raw.strip()
        if not pat:
            continue
        if pat.endswith("/**"):
            dir_target = pat[:-3]
            if "/" not in dir_target and dir_target in parent_parts:
                return True
            continue
        if pat.endswith("/"):
            dir_target = pat[:-1]
            if "/" not in dir_target and dir_target in parent_parts:
                return True
            continue
        if pat.startswith("**/"):
            glob = pat[3:]
            if pathlib.PurePosixPath(name).match(glob):
                return True
            continue
        if "/" in pat:
            if pathlib.PurePosixPath(str(rel_path)).match(pat):
                return True
            continue
        if pathlib.PurePosixPath(name).match(pat):
            return True

    return False


def _walk_python_files(
    root: pathlib.Path,
    patterns: List[str],
    extra_excluded_dirs: Iterable[str] = (),
    extra_excluded_file_names: Iterable[str] = (),
) -> Iterable[pathlib.Path]:
    """Yield every *.py under root, applying rsync-manifest exclusions.

    `root` is the qsh package directory. The exclusion patterns are applied
    against paths relative to root (so `tests/` matches `tests/foo.py` and
    `api/tests/bar.py` alike).
    """
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if _is_excluded(
            rel, patterns, extra_excluded_dirs, extra_excluded_file_names
        ):
            continue
        yield path


def _resolve_relative(
    file_rel_path: pathlib.Path,
    level: int,
    module: Optional[str],
) -> Optional[str]:
    """Resolve a relative-import statement to its absolute dotted form.

    `file_rel_path` is the importing file's path relative to the package
    root (parent of qsh/). Example: `qsh/pipeline/controllers/foo.py` →
    parts ('qsh', 'pipeline', 'controllers', 'foo.py').

    `level` is the AST `ImportFrom.level` (1 = single dot, 2 = two dots,
    etc.). `module` is `ImportFrom.module` (may be None for `from . import x`).

    Returns the absolute dotted module the statement references, e.g.
    `qsh.pipeline.controllers.context` for `from .context import X` from
    inside qsh/pipeline/controllers/foo.py. Returns the sentinel
    `<malformed-relative:level=N>` if the level walks past the package
    root. Returns None if the resolved target is not in the qsh namespace.
    """
    parent_pkg_parts = list(file_rel_path.parts[:-1])

    # __init__.py is its own package's "current" location. For non-init
    # files, the file's package is its parent directory. AST-wise the
    # algorithm is identical: drop the file name to get the package parts.
    # An __init__.py at qsh/pipeline/__init__.py has parent_pkg_parts =
    # ['qsh', 'pipeline'], which is correct — `from . import X` from inside
    # that __init__ refers to qsh.pipeline.X.

    if level > 1:
        if len(parent_pkg_parts) < level - 1:
            return f"<malformed-relative:level={level}>"
        base_parts = parent_pkg_parts[: -(level - 1)]
    else:
        base_parts = parent_pkg_parts

    if module:
        base_parts = base_parts + module.split(".")

    if not base_parts or base_parts[0] != "qsh":
        return None

    return ".".join(base_parts)


def _collect_qsh_references(
    py_path: pathlib.Path,
    package_root: pathlib.Path,
) -> List[Tuple[int, str, str]]:
    """Return [(lineno, dotted_target, ast_shape), ...] for qsh references.

    Four AST shapes are recorded:
      - `import qsh.X.Y`           → ('import',             'qsh.X.Y')
      - `from qsh.X import Y`      → ('from-qsh-X-import',  'qsh.X.Y')   per name
      - `from qsh import X`        → ('from-qsh-import',    'qsh.X')     per name
      - `from .x import Y` etc.    → ('from-relative-import', resolved)  per name

    Exempt:
      - bare `import qsh` (parent stub always exists)

    `package_root` is the directory CONTAINING qsh/ (i.e. the parent of the
    qsh package). It is used to compute the importing file's dotted-path
    parts for relative-import resolution.
    """
    refs: List[Tuple[int, str, str]] = []
    try:
        tree = ast.parse(py_path.read_text(), filename=str(py_path))
    except SyntaxError as exc:
        print(f"FATAL: AST parse failure on {py_path}: {exc}", file=sys.stderr)
        sys.exit(2)

    file_rel_path = py_path.relative_to(package_root)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                target = alias.name
                if target == "qsh":
                    continue
                if target.startswith("qsh."):
                    refs.append((node.lineno, target, "import"))
        elif isinstance(node, ast.ImportFrom):
            if node.level > 0:
                resolved = _resolve_relative(
                    file_rel_path, node.level, node.module
                )
                if resolved is None:
                    # Resolved outside the qsh namespace (or to bare
                    # parent of `qsh`, which cannot legally happen from
                    # inside qsh/). Skip.
                    continue
                if resolved.startswith("<malformed-relative"):
                    refs.append(
                        (node.lineno, resolved, "from-relative-import")
                    )
                    continue
                for alias in node.names:
                    refs.append(
                        (
                            node.lineno,
                            f"{resolved}.{alias.name}",
                            "from-relative-import",
                        )
                    )
                continue
            module = node.module or ""
            if module == "qsh":
                for alias in node.names:
                    refs.append(
                        (node.lineno, f"qsh.{alias.name}", "from-qsh-import")
                    )
            elif module.startswith("qsh."):
                for alias in node.names:
                    refs.append(
                        (
                            node.lineno,
                            f"{module}.{alias.name}",
                            "from-qsh-X-import",
                        )
                    )
    return refs


def _build_real_modules_set(qsh_root: pathlib.Path) -> Set[str]:
    """Walk qsh_root and return dotted names of real .py module files.

    Excludes __init__.py — those are packages, not modules. The set is used
    by `_resolve` to distinguish a missing-from-compile-list sub-module
    (real file → must be on compile list) from an attribute defined in an
    __init__.py (no file → resolved at runtime against the shipped
    __init__.py).
    """
    modules: Set[str] = set()
    package_root = qsh_root.parent
    for path in qsh_root.rglob("*.py"):
        if path.name == "__init__.py":
            continue
        rel = path.relative_to(package_root)
        dotted = ".".join(rel.with_suffix("").parts)
        modules.add(dotted)
    return modules


def _resolve(
    target: str,
    compile_list: Set[str],
    whole_tree_paths: Set[str],
    init_only_paths: Set[str],
    real_modules: Set[str],
) -> bool:
    """Resolution rule per V2 Finding 5 + INSTRUCTION-175 Task 3 split.

    target = qsh.X.Y.Z resolves iff:
      - it equals an init-only-ship path (bare package import is legal), OR
      - some NON-BARE prefix (qsh.X.Y.Z, qsh.X.Y, qsh.X) matches the
        compile list OR a whole-tree-ship path, OR
      - a NON-BARE prefix matches an init-only-ship path AND the
        immediately-next segment does NOT correspond to a real .py module
        file (i.e. the trailing parts are an attribute defined on the
        shipped __init__.py, not a missing sub-module).

    Discriminating example (Task 3): target qsh.pipeline.controllers.
    tariff_optimiser. Prefix qsh.pipeline.controllers IS in
    INIT_ONLY_SHIP_PATHS, but qsh/pipeline/controllers/tariff_optimiser.py
    is a real file — therefore the trailing tariff_optimiser is a
    SUB-MODULE that must appear on the compile list, not an attribute.
    The init-only-ship match does NOT grant legality. The new rule fails
    this target iff the compile list is missing the entry.

    Counter-example (Task 5 T5.2): target qsh.pipeline.controllers.
    HWController. Prefix qsh.pipeline.controllers is init-only-ship, but
    no qsh/pipeline/controllers/HWController.py file exists — HWController
    is a class re-exported from the shipped __init__.py. The init-only-
    ship match grants legality (attribute reference, runtime-resolvable).

    The bare `qsh` package's presence does NOT satisfy resolution for
    sub-attribute references (V2 Finding 5). The loop ranges from
    len(parts) down to 2, never matching the bare `qsh`.
    """
    if target in init_only_paths:
        return True

    eligible = compile_list | whole_tree_paths
    parts = target.split(".")

    for i in range(len(parts), 1, -1):
        if ".".join(parts[:i]) in eligible:
            return True

    for i in range(len(parts), 1, -1):
        prefix = ".".join(parts[:i])
        if prefix in init_only_paths:
            if i >= len(parts):
                continue
            next_module_dotted = ".".join(parts[: i + 1])
            if next_module_dotted not in real_modules:
                return True
            return False

    return False


def check_tree(
    qsh_root: pathlib.Path,
    package_root: pathlib.Path,
    compile_list_entries: Set[str],
    whole_tree_paths: Set[str],
    init_only_paths: Set[str],
    exclusion_patterns: List[str],
    extra_excluded_dirs: Iterable[str] = (),
    extra_excluded_file_names: Iterable[str] = (),
    repo_root: Optional[pathlib.Path] = None,
) -> Tuple[List[Tuple[str, int, str, str]], int]:
    """Walk qsh_root and return (violations, total_refs).

    Testable entry point. `main()` is a thin wrapper that loads the
    module-level constants and calls this. All paths used in violation
    reporting are relative to `repo_root` (defaulting to `package_root`'s
    parent if not provided).
    """
    if repo_root is None:
        repo_root = package_root.parent

    real_modules = _build_real_modules_set(qsh_root)

    violations: List[Tuple[str, int, str, str]] = []
    total_refs = 0
    for py_path in _walk_python_files(
        qsh_root,
        exclusion_patterns,
        extra_excluded_dirs,
        extra_excluded_file_names,
    ):
        for lineno, target, shape in _collect_qsh_references(
            py_path, package_root
        ):
            total_refs += 1
            if target.startswith("<malformed-relative"):
                rel = py_path.relative_to(repo_root)
                violations.append((str(rel), lineno, target, shape))
                continue
            if not _resolve(
                target,
                compile_list_entries,
                whole_tree_paths,
                init_only_paths,
                real_modules,
            ):
                rel = py_path.relative_to(repo_root)
                violations.append((str(rel), lineno, target, shape))

    return violations, total_refs


def main() -> int:
    if not COMPILE_LIST.is_file():
        print(f"FATAL: compile list not found: {COMPILE_LIST}", file=sys.stderr)
        return 2
    if not QSH_ROOT.is_dir():
        print(f"FATAL: qsh root not found: {QSH_ROOT}", file=sys.stderr)
        return 2

    compile_entries = set(_read_compile_list(COMPILE_LIST).keys())
    exclusion_patterns = _read_exclusion_manifest(PUBLIC_EXCLUSION_MANIFEST)

    violations, total_refs = check_tree(
        qsh_root=QSH_ROOT,
        package_root=PACKAGE_ROOT,
        compile_list_entries=compile_entries,
        whole_tree_paths=WHOLE_TREE_SHIP_PATHS,
        init_only_paths=INIT_ONLY_SHIP_PATHS,
        exclusion_patterns=exclusion_patterns,
        extra_excluded_dirs=EXTRA_EXCLUDED_DIRS,
        extra_excluded_file_names=EXTRA_EXCLUDED_FILE_NAMES,
        repo_root=REPO_ROOT,
    )

    if violations:
        print("Import integrity FAIL — unresolved qsh-namespace references:")
        for path, lineno, target, shape in violations:
            print(f"  {path}:{lineno}  ({shape})  -> {target}")
        print()
        print(
            "Remediation: add the missing module to "
            f"{COMPILE_LIST.name}, OR document the source-ship path in "
            "release-sync.sh."
        )
        return 1

    print(
        f"Import integrity OK — {total_refs} qsh-namespace references checked, "
        "all resolved"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
