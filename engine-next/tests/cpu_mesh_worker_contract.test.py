#!/usr/bin/env python3
"""Static contract checks for the GPU-independent mesh-only execution path."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "engine-next" / "reconstruction" / "pipeline.py"
WORKER = ROOT / "kaggle" / "fumoca_cpu_mesh_worker.py"


def main():
    pipeline_text = PIPELINE.read_text(encoding="utf-8")
    tree = ast.parse(pipeline_text)
    top_level_imports = {
        alias.name
        for node in tree.body if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "numpy" in top_level_imports
    assert "torch" not in top_level_imports, "torch must be optional"
    assert "gsplat" not in top_level_imports, "gsplat must be optional"
    assert "try:\\n    import torch" in pipeline_text
    assert "except ImportError:" in pipeline_text
    assert "gsplat unavailable; mesh-only CPU jobs remain supported" in pipeline_text
    assert "initialize_deblur: bool = True" in pipeline_text
    assert "if initialize_deblur:" in pipeline_text
    assert "if torch is None or gsplat is None:" in pipeline_text

    worker_text = WORKER.read_text(encoding="utf-8")
    ast.parse(worker_text)
    assert "torch" not in {
        alias.name
        for node in ast.walk(ast.parse(worker_text))
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "claim_next_mesh_only_job" in worker_text
    assert "initialize_deblur=False" in worker_text
    assert "run_mesh_only(raw_key, meta)" in worker_text
    print("CPU mesh worker contract: PASS")


if __name__ == "__main__":
    main()
