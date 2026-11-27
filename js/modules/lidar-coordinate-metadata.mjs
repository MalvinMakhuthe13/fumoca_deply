/**
 * Coordinate provenance carried in a PLY comment.
 *
 * PLY viewers ignore comments, so this does not affect rendering. It lets
 * FUMOCA recover a local render origin when a converted PLY is imported again.
 */
const PREFIX = 'comment fumoca_coordinate_metadata ';

export function serializePlyCoordinateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  try {
    const json = JSON.stringify(metadata);
    if (!json || json.length > 8192 || /[\r\n]/.test(json)) return null;
    return PREFIX + json;
  } catch {
    return null;
  }
}

export function parsePlyCoordinateMetadata(headerText) {
  if (typeof headerText !== 'string') return null;
  const line = headerText.split(/\r?\n/).find(value => value.startsWith(PREFIX));
  if (!line) return null;
  try {
    const metadata = JSON.parse(line.slice(PREFIX.length));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    return metadata;
  } catch {
    return null;
  }
}
