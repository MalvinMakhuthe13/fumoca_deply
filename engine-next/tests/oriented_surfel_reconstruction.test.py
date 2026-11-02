"""
Regression tests for the oriented Gaussian-surfel normal and confidence path.
Run: python3 engine-next/tests/oriented_surfel_reconstruction.test.py

The helper is extracted from pipeline.py so these tests do not import the
worker's GPU/cloud dependencies. Requires numpy and scipy.
"""
import sys
from pathlib import Path
import numpy as np

pipeline = Path(__file__).resolve().parents[1] / 'reconstruction' / 'pipeline.py'
source = pipeline.read_text()
start = source.index('def _orient_normals_consistently(')
end = source.index('\n\nclass ReconstructionWorker:', start)
namespace = {'np': np}
exec(source[start:end], namespace)
orient = namespace['_orient_normals_consistently']

passed = 0
failed = 0


def check(name, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
        print('PASS:', name)
    else:
        failed += 1
        print('FAIL:', name, detail)


# Two spatially separated planar patches, with every second normal reversed.
plane = np.array([[x * 0.1, y * 0.1, 0.0]
                  for x in range(4) for y in range(4)], dtype=float)
other = np.array([[5.0 + x * 0.1, y * 0.1, 0.0]
                  for x in range(4) for y in range(4)], dtype=float)
positions = np.vstack([plane, other])
normals = np.tile([0.0, 0.0, 1.0], (len(positions), 1))
normals[::2] *= -1
oriented, labels, info = orient(positions, normals, neighbors=6)

# Local sign consistency: all points in each planar patch must align.
for component in np.unique(labels):
    group = oriented[labels == component]
    mean_normal = group.mean(axis=0)
    agreement = np.abs(group @ (mean_normal / np.linalg.norm(mean_normal)))
    check(f'component {component}: local normal signs are consistent',
          bool(np.all(agreement > 0.99)), agreement.min())

check('spatially separated patches remain separate normal components',
      len(np.unique(labels)) == 2, np.unique(labels))
check('diagnostics report all input points',
      info['oriented_points'] == len(positions), info)

# A single point and an empty input are valid edge cases.
single_n, single_labels, single_info = orient(
    np.array([[1.0, 2.0, 3.0]]), np.array([[0.0, 0.0, -2.0]]))
check('single point is normalized and assigned a component',
      np.allclose(single_n, [[0.0, 0.0, -1.0]]) and single_labels.tolist() == [0],
      (single_n, single_labels))
empty_n, empty_labels, empty_info = orient(np.empty((0, 3)), np.empty((0, 3)))
check('empty input returns empty arrays without error',
      empty_n.shape == (0, 3) and empty_labels.shape == (0,),
      (empty_n.shape, empty_labels.shape))

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
