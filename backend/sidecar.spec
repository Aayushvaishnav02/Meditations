# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the packaged backend sidecar (one-dir build, fast
# startup — no onefile tmp extraction). Built from backend/ with:
#   uv run pyinstaller sidecar.spec --noconfirm --distpath ../frontend/src-tauri/binaries
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

datas = collect_data_files("sqlite_vec")  # bundles the vec0 loadable extension
datas += collect_data_files("fastembed")

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
