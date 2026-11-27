/**
 * Read the optional INTERACTION manifest from a NIF binary.
 *
 * Kept separate from nif-format.js so the established production decoder
 * remains untouched. The NIFReader validates the container/chunk framing;
 * decodeInteractiveChunk validates the manifest before returning it.
 */
import { CHUNK, NIFReader } from '../../engine-next/format/NIFSpec.js';
import { decodeInteractiveChunk } from '../../engine-next/format/NIFInteractiveSpec.js';

export async function readNifInteractiveManifest(input) {
  const reader = input instanceof NIFReader ? input : new NIFReader(input);
  const chunk = reader.getChunk(CHUNK.INTERACTION);
  return decodeInteractiveChunk(chunk);
}
