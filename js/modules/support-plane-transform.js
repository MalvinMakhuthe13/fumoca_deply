/**
 * Pure support-plane transform utilities shared by Studio and tests.
 * Plane equation: dot(normal, point) = offset. The supplied normal is
 * reoriented toward +Y (the object side) before the plane is levelled.
 */

function rotateVector(vector, quaternion) {
  const [qx, qy, qz, qw] = quaternion;
  const [x, y, z] = vector;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

export function buildSupportPlaneTransform(normalInput, offsetInput) {
  if (!normalInput || normalInput.length !== 3) throw new TypeError('support-plane normal must contain three values');
  const normal = Array.from(normalInput, Number);
  let offset = Number(offsetInput);
  if (!normal.every(Number.isFinite) || !Number.isFinite(offset)) throw new TypeError('support-plane values must be finite');
  const length = Math.hypot(...normal);
  if (length < 1e-8) throw new RangeError('support-plane normal is degenerate');
  for (let i = 0; i < 3; i++) normal[i] /= length;
  offset /= length;
  if (normal[1] < 0) {
    for (let i = 0; i < 3; i++) normal[i] *= -1;
    offset *= -1;
  }

  // Shortest-arc quaternion rotating the oriented plane normal to world +Y.
  const dot = Math.max(-1, Math.min(1, normal[1]));
  const cross = [-normal[2], 0, normal[0]];
  const raw = [...cross, 1 + dot];
  const qLength = Math.hypot(...raw);
  const quaternion = raw.map(value => value / qLength);
  const origin = normal.map(value => value * offset);

  return {
    normal: normal.slice(),
    offset,
    origin,
    quaternion, // x,y,z,w
    transformPoint(point) {
      if (!point || point.length !== 3) throw new TypeError('point must contain three values');
      return rotateVector([
        Number(point[0]) - origin[0],
        Number(point[1]) - origin[1],
        Number(point[2]) - origin[2],
      ], quaternion);
    },
    transformPositionArray(source) {
      if (!source || source.length % 3) throw new TypeError('position array length must be divisible by three');
      const output = new Float32Array(source.length);
      for (let i = 0; i < source.length; i += 3) {
        const point = rotateVector([
          Number(source[i]) - origin[0],
          Number(source[i + 1]) - origin[1],
          Number(source[i + 2]) - origin[2],
        ], quaternion);
        output[i] = point[0];
        output[i + 1] = point[1];
        output[i + 2] = point[2];
      }
      return output;
    },
    transformGaussianRotationsWxyz(source) {
      if (!source || source.length % 4) throw new TypeError('Gaussian rotation array length must be divisible by four');
      const output = new Float32Array(source.length);
      const [lx, ly, lz, lw] = quaternion;
      for (let i = 0; i < source.length; i += 4) {
        const gw = Number(source[i]), gx = Number(source[i + 1]);
        const gy = Number(source[i + 2]), gz = Number(source[i + 3]);
        const length = Math.hypot(gw, gx, gy, gz) || 1;
        const w = gw / length, x = gx / length, y = gy / length, z = gz / length;
        const nx = lw * x + lx * w + ly * z - lz * y;
        const ny = lw * y - lx * z + ly * w + lz * x;
        const nz = lw * z + lx * y - ly * x + lz * w;
        const nw = lw * w - lx * x - ly * y - lz * z;
        const qNorm = Math.hypot(nw, nx, ny, nz) || 1;
        output[i] = nw / qNorm;
        output[i + 1] = nx / qNorm;
        output[i + 2] = ny / qNorm;
        output[i + 3] = nz / qNorm;
      }
      return output;
    },
  };
}
