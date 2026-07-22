# FUMOC v2 — Open Format Specification
**Version:** 2.0  
**Status:** Released  
**Reference implementation:** fumoca.io/spec/fumoc-v2  
**Licence:** MIT — implement freely, no royalty for decoding

---

## What is FUMOC?

FUMOC (.fumoc) is an open compressed container format for Gaussian Splat 3D scenes.
It is to Gaussian Splats what MP4 is to video — a compressed, portable, universally
openable format that any application can implement.

A single .fumoc file contains:
- The compressed 3D scene (Gaussian Splat data)
- Metadata (title, description, mode, author)
- Interactive data (hotspots, camera tours, motion states)
- A thumbnail image (JPEG) for previews without loading 3D data
- Branding and whitelabel config

**Design principle:** The format is open. Any app that ships the decoder
(~400 lines of pure math, no dependencies) can open .fumoc files natively.

---

## File structure

```
[8B  magic]          ASCII: "FUMOC2\0\0"
[2B  version]        uint16 little-endian: 0x0002
[4B  header_len]     uint32 little-endian: byte length of header JSON
[?B  header JSON]    UTF-8 encoded JSON object (see Header fields)
[sections...]        One or more sections (see Section structure)
```

### Header fields

| Field | Type | Description |
|-------|------|-------------|
| `fumoc_version` | int | Always 2 for v2 files |
| `fumoc_spec` | string | "2.0" |
| `title` | string | Human-readable scene name |
| `description` | string | Scene description |
| `mode` | string | "product" \| "vehicle" \| "real_estate" \| "event" \| "person" |
| `n_gaussians` | int | Number of Gaussians in the scene |
| `quality` | string | "high" \| "medium" \| "low" |
| `input_byte_length` | int | Original uncompressed size in bytes |
| `created` | string | ISO 8601 timestamp |
| `has_tour` | bool | True if TOUR section present |
| `has_hotspots` | bool | True if HOTS section present |
| `has_thumbnail` | bool | True if THUM section present |
| `encoder` | string | Encoder name and version |
| `open_spec` | string | URL to this document |

---

## Section structure

Each section immediately follows the previous one (no padding or alignment):

```
[4B  section_id]     ASCII 4-char identifier
[1B  flags]          Bit 0 = deflate compressed; Bit 1 = FUMOC v2 codec
[4B  comp_len]       uint32 LE: compressed byte length of data
[4B  raw_len]        uint32 LE: uncompressed byte length (before compression)
[?B  data]           comp_len bytes of section data
```

### Section IDs

| ID | Description | Encoding |
|----|-------------|----------|
| `SPLT` | Gaussian Splat data | FUMOC v2 codec (flags bit 1 set) |
| `META` | Metadata JSON | deflate |
| `TOUR` | Tour stops JSON array | deflate |
| `HOTS` | Hotspots JSON array | deflate |
| `THUM` | Thumbnail JPEG bytes | deflate |
| `MOTN` | Motion states JSON | deflate |
| `CAMR` | Saved cameras JSON | deflate |
| `BRND` | Branding config JSON | deflate |

Unknown section IDs must be silently skipped — this ensures forward
compatibility when new section types are added in future versions.

---

## SPLT section v2 — codec detail

The SPLT section uses the FUMOC v2 compression codec. It is NOT a raw
.splat binary wrapped in deflate — it is a structured block of
independently compressed property channels.

### SPLT body structure

```
[4B  n_gaussians]   uint32 LE
[4B  n_channels]    uint32 LE
[channels...]       n_channels channel blocks (see below)
```

### Channel block structure

```
[1B  channel_id]       See channel table below
[512B freq_table]      ANS frequency table (256 × uint16 LE)
[4B  meta_json_len]    uint32 LE
[?B  meta_json]        UTF-8 JSON with decode parameters
[4B  compressed_len]   uint32 LE
[?B  compressed_data]  ANS-compressed bytes
```

### Channel IDs

| ID | Property | Type | Delta | Quantise |
|----|----------|------|-------|----------|
| 0x01 | Position X | float32 | Yes | 16-bit signed |
| 0x02 | Position Y | float32 | Yes | 16-bit signed |
| 0x03 | Position Z | float32 | Yes | 16-bit signed |
| 0x04 | Scale X (log) | float32 | Yes | 8–16-bit |
| 0x05 | Scale Y (log) | float32 | Yes | 8–16-bit |
| 0x06 | Scale Z (log) | float32 | Yes | 8–16-bit |
| 0x07 | Colour R | uint8 | No | passthrough |
| 0x08 | Colour G | uint8 | No | passthrough |
| 0x09 | Colour B | uint8 | No | passthrough |
| 0x0A | Opacity (A) | uint8 | No | passthrough |
| 0x0B | Rotation Q0 | uint8 | No | passthrough |
| 0x0C | Rotation Q1 | uint8 | No | passthrough |
| 0x0D | Rotation Q2 | uint8 | No | passthrough |
| 0x0E | Rotation Q3 | uint8 | No | passthrough |
| 0x0F | Sort index | uint32[] | No | passthrough |

Unknown channel IDs must be silently skipped.

### Channel meta_json fields

```json
{
  "min":    -3.14,     // original float minimum (for dequantise)
  "max":     3.14,     // original float maximum (for dequantise)
  "bits":    16,       // quantisation bits (8 or 16)
  "delta":   true,     // was delta coding applied?
  "signed":  true,     // signed quantisation?
  "length":  1000000   // number of values
}
```

---

## Decode algorithm (pseudo-code)

```
function decode_fumoc(bytes):
  assert bytes[0:6] == "FUMOC2"
  version    = read_uint16_le(bytes, 8)
  header_len = read_uint32_le(bytes, 10)
  header     = parse_json(bytes[14 : 14 + header_len])
  offset     = 14 + header_len

  while offset < len(bytes):
    section_id  = ascii(bytes[offset : offset+4])
    flags       = bytes[offset+4]
    comp_len    = read_uint32_le(bytes, offset+5)
    raw_len     = read_uint32_le(bytes, offset+9)
    data        = bytes[offset+13 : offset+13+comp_len]
    offset     += 13 + comp_len

    if section_id == "SPLT":
      gaussians = decode_splt_v2(data)
    elif section_id == "META":
      meta = parse_json(inflate(data) if flags&1 else data)
    elif section_id == "THUM":
      thumbnail_jpeg = inflate(data) if flags&1 else data
    # ... etc. Unknown IDs: skip.

  return { gaussians, meta, thumbnail_jpeg, ... }


function decode_splt_v2(data):
  n_gaussians = read_uint32_le(data, 0)
  n_channels  = read_uint32_le(data, 4)
  offset = 8
  channels = {}

  for i in range(n_channels):
    chan_id      = data[offset]
    freq_table   = data[offset+1 : offset+513]     # 512 bytes = 256 × uint16
    meta_len     = read_uint32_le(data, offset+513)
    meta         = parse_json(data[offset+517 : offset+517+meta_len])
    comp_len     = read_uint32_le(data, offset+517+meta_len)
    compressed   = data[offset+521+meta_len : offset+521+meta_len+comp_len]
    offset      += 521 + meta_len + comp_len

    channels[chan_id] = decode_channel(compressed, freq_table, meta)

  return assemble_gaussians(n_gaussians, channels)


function decode_channel(compressed, freq_table, meta):
  bytes_per = 2 if meta.bits > 8 else 1
  raw_bytes = ans_decode(compressed, freq_table, meta.length * bytes_per)

  # Reverse zigzag encoding
  if meta.bits > 8:
    quant = int16_array(meta.length)
    for i in range(meta.length):
      zz = read_uint16_le(raw_bytes, i*2)
      quant[i] = -(zz+1)//2 if zz&1 else zz//2
  else:
    quant = int8_array(meta.length)
    for i in range(meta.length):
      zz = raw_bytes[i]
      quant[i] = -(zz+1)//2 if zz&1 else zz//2

  # Reverse delta coding
  if meta.delta:
    for i in range(1, meta.length):
      quant[i] += quant[i-1]

  # Dequantise to float
  levels = (1 << meta.bits) - 1
  range_ = meta.max - meta.min
  floats = float32_array(meta.length)
  for i in range(meta.length):
    if meta.signed:
      norm = (quant[i] + levels//2) / levels
    else:
      norm = quant[i] / levels
    floats[i] = meta.min + norm * range_

  return floats
```

---

## ANS (rANS) decode algorithm

The ANS decoder used in FUMOC v2 is standard rANS with:
- M = 4096 (table size, ANS_M)
- L = 2^23 (lower bound, ANS_L)
- b = 256 (byte I/O)

```
function ans_decode(compressed, freq_table_bytes, output_length):
  # Parse frequency table: 256 × uint16 LE
  freq = [read_uint16_le(freq_table_bytes, i*2) for i in range(256)]
  
  # Build cumulative frequency table
  cum_freq = [0] * 257
  for s in range(256):
    cum_freq[s+1] = cum_freq[s] + freq[s]
  assert cum_freq[256] == 4096  # must sum to ANS_M

  # Build O(1) decode table: slot → symbol
  decode_table = [0] * 4096
  for sym in range(256):
    for slot in range(cum_freq[sym], cum_freq[sym+1]):
      decode_table[slot] = sym

  # Read initial state from first 4 bytes (little-endian uint32)
  state = read_uint32_le(compressed, 0)
  byte_pos = 4
  output = byte_array(output_length)

  for i in range(output_length):
    slot    = state % 4096           # ANS_M = 4096
    sym     = decode_table[slot]
    output[i] = sym
    f       = freq[sym]
    c       = cum_freq[sym]
    state   = f * (state // 4096) + slot - c

    # Renormalise
    while state < 8388608:            # ANS_L = 2^23
      state = (state << 8) | compressed[byte_pos]
      byte_pos += 1

  return output
```

---

## Raw Gaussian output format

After decoding, the Gaussians should be presented as a standard .splat
binary (32 bytes per Gaussian, little-endian):

```
[4B float32] X position
[4B float32] Y position
[4B float32] Z position
[4B float32] Scale X (log-space)
[4B float32] Scale Y (log-space)
[4B float32] Scale Z (log-space)
[1B uint8]   Red
[1B uint8]   Green
[1B uint8]   Blue
[1B uint8]   Alpha (opacity)
[1B uint8]   Rotation Q0
[1B uint8]   Rotation Q1
[1B uint8]   Rotation Q2
[1B uint8]   Rotation Q3
```

This layout is compatible with @mkkellogg/gaussian-splats-3d,
Luma AI's web viewer, and all other .splat-format renderers.

---

## Implementing in other languages

The decode algorithm above is complete. A minimal decoder needs:
1. File header reader (trivial byte offsets)
2. Section iterator (trivial loop)
3. ANS decoder (~50 lines)
4. Zigzag + delta reverse (~20 lines)
5. Dequantise (~10 lines)
6. DeflateDecompress for non-SPLT sections (standard library in every language)

Reference implementations:
- JavaScript/WASM: `fumoc-decoder.js` (this codebase)
- Python: fumoca.io/spec/fumoc-v2/decoder.py (coming)
- C/C++: fumoca.io/spec/fumoc-v2/decoder.c (coming)
- Swift: fumoca.io/spec/fumoc-v2/decoder.swift (coming)
- Kotlin: fumoca.io/spec/fumoc-v2/decoder.kt (coming)

---

## Compatibility

| Version | Magic | SPLT encoding | Decoder |
|---------|-------|---------------|---------|
| v1 | FUMOC1 | Raw .splat + deflate | Both decoders handle v1 |
| v2 | FUMOC2 | FUMOC v2 codec (this spec) | This document |

The v2 decoder also reads v1 files (detects magic bytes, routes to v1 path).

---

## Licence

This specification and the reference implementations are published under
the MIT licence. Any application may implement the FUMOC format without
royalty payment for the purpose of decoding .fumoc files.

The FUMOCA platform (fumoca.io) retains copyright on:
- The FUMOCA brand and logo
- The cloud encoding/API service
- The FUMOCA viewer application

The format itself is open.

---

*FUMOC v2 Specification — FUMOCA (Pty) Ltd — fumoca.io*


---

## Appendix A — FUMOC v2 File Format, Codec v3 Upgrades

### Overview

Files encoded with codec v3 are fully decodable by any v2 decoder
for all channels except order-1 ANS channels. The `order` field in
each channel's meta_json signals which decoder path to use.

### Change 1: Radix sort replaces comparison sort

The Morton sort in Stage 1 now uses an 8-pass LSD radix sort on the
packed 63-bit Morton code. This is O(N) vs O(N log N) for comparison
sort. No changes to the output — sorted order is identical.
Decoder is unaffected.

### Change 2: ANS normalisation fix

The normalisation bound in rANS encoding was:
```
maxState = ((ANS_L >> 8) << 8) * f   // v2 — integer overflow for f > 16384
```
Correct formula:
```
maxState = Math.floor(ANS_L / ANS_M) * f  // v3 — correct, no overflow
```
For ANS_L = 2^23, ANS_M = 4096: Math.floor(ANS_L / ANS_M) = 2048.
The v2 formula evaluates to the same value for all f < 16384 (which
covers ~99.9% of real channels). Files where f ≥ 16384 were encoded
incorrectly in v2 — v3 fixes this. Both decoders handle both cases.

### Change 3: Order-1 rANS (position and scale channels only)

When `meta.order == 1` in a channel's meta_json, the channel uses
order-1 rANS tables. The freqTable field contains 131072 bytes
(256 contexts × 256 symbols × 2 bytes) instead of 512 bytes.

Decoder pseudo-code change:
```
if meta.order == 1:
    rawBytes = ans_decode_order1(compressed, freqTable, length * bytesPerSample)
else:
    rawBytes = ans_decode_order0(compressed, freqTable[:512], length * bytesPerSample)
```

The order-1 decode table is:
  decodeTable[ctx * ANS_M + slot] = symbol
Size: 256 × 4096 × 1 byte = 1MB — allocated once per channel decode.

### Change 4: Adaptive perceptual quantisation

When a channel uses adaptive quantisation, `meta.min` and `meta.max`
reflect the P1 and P99 percentile values of the channel data, NOT
the absolute min/max. Values outside this range are clamped to the
boundary before quantisation.

This affects the decoder only in that the dequantised values may
be slightly different from absolute min/max — the dequantise formula
is unchanged. Any value that was clamped during encoding will
reconstruct to the boundary value, not the original outlier.
