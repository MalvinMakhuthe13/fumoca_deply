#!/usr/bin/env python3
"""Syntax-check executable inline JavaScript in edit.html with the installed Node runtime."""
from pathlib import Path
import re
import subprocess
import sys

html = Path("edit.html").read_text(encoding="utf-8")

# Persistence must close the current legacy-adapter gesture before serializing.
required_history_flushes = (
    "if (!settlePendingStudioHistory('export')) return;",
    "if (!settlePendingStudioHistory('save')) return false;",
)
for required in required_history_flushes:
    if required not in html:
        raise SystemExit(f"Missing unified-history persistence guard: {required}")
# Mesh extraction and component editing share these refresh helpers. Guard
# against call sites surviving while their implementations disappear.
mesh_module = Path("js/modules/studio-mesh-print.js").read_text(encoding="utf-8")
for helper in (
    "const refreshCombinedMeshFromComponents =",
    "const renderMeshDiagnostics =",
    "const updateMeshPreview =",
    "const makeMeshBlob =",
):
    if helper not in mesh_module:
        raise SystemExit(f"Missing Studio mesh integration helper: {helper}")

pattern = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.IGNORECASE | re.DOTALL)
checked = 0
errors = []

for index, match in enumerate(pattern.finditer(html), start=1):
    attrs, source = match.group(1), match.group(2)
    if re.search(r"\bsrc\s*=", attrs, re.IGNORECASE) or not source.strip():
        continue
    type_match = re.search(r"""\btype\s*=\s*["']?([^\s"'>]+)""", attrs, re.IGNORECASE)
    script_type = type_match.group(1).lower() if type_match else "text/javascript"
    if script_type not in ("module", "text/javascript", "application/javascript"):
        continue
    args = ["node", "--check"]
    if script_type == "module":
        args.append("--input-type=module")
    result = subprocess.run(args, input=source, text=True, capture_output=True)
    checked += 1
    if result.returncode:
        errors.append((index, result.stderr.strip()))

if errors:
    for index, message in errors:
        print(f"Inline script #{index} failed syntax check:\n{message}", file=sys.stderr)
    raise SystemExit(1)

print(f"Syntax OK: {checked} executable inline script blocks in edit.html")
