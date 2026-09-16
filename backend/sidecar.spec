# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the packaged backend sidecar (one-dir build, fast
# startup — no onefile tmp extraction). Built from backend/ with:
#   uv run pyinstaller sidecar.spec --noconfirm --distpath ../frontend/src-tauri/binaries
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

datas = collect_data_files("sqlite_vec")  # bundles the vec0 loadable extension
datas += collect_data_files("fastembed")

# several deps (genai_prices, pydantic_ai, ...) read their version or config
# via importlib.metadata — frozen apps need the dist-info shipped explicitly
import importlib.metadata as _md  # noqa: E402

for _dist in _md.distributions():
    if not _dist.name or _dist.name == "pyinstaller":
        continue
    try:
        from PyInstaller.utils.hooks import copy_metadata

        datas += copy_metadata(_dist.name)
    except Exception as _err:  # noqa: BLE001 — report, don't silently drop
        print(f"copy_metadata failed for {_dist.name}: {_err}")

print(f"SPECCHECK: {len(datas)} data entries after metadata copy")

binaries = collect_dynamic_libs("onnxruntime")
binaries += collect_dynamic_libs("sqlite_vec")

# entry-point/dynamic imports invisible to static analysis
hiddenimports = (
    collect_submodules("app")
    + collect_submodules("uvicorn")
    + collect_submodules("pydantic_ai")
    + [
        "fastembed",
        "onnxruntime",
        "aiosqlite",
        "sqlmodel",
        "sqlalchemy.dialects.sqlite.aiosqlite",  # resolved via entry point at runtime
        "sqlite_vec",
    ]
)

a = Analysis(
    ["sidecar_main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    excludes=["tkinter", "matplotlib", "PIL", "pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    exclude_binaries=True,
    name="meditations-backend",
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    name="meditations-backend",
)
