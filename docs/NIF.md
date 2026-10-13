# NIF — Neural Interactive Format

**Status:** Established specification · v1.1  
**Extension:** `.nif`  
**MIME:** `model/x-nif`  
**Magic:** `NIF\0` (`0x4E 0x49 0x46 0x00`)

NIF is FUMOCA’s portable container for spatial captures: Gaussian / volumetric field, metadata, optional mesh, camera paths, print pack, and social proxy assets — **one file**.

---

## Design principles

| Principle | Meaning |
|-----------|---------|
| **Readable freely** | Any app may implement a NIF *reader* from the public spec |
| **Write is licensed** | Encoders require a FUMOCA encoder license; uncertified files may show a viewer watermark |
| **Chunked** | Unknown chunks are skipped — forward compatible |
| **Social-first** | Thumbnail + optional proxy video for feeds and embeds |
| **Print-aware** | Optional print-export chunk for watertight mesh workflows |

---

## Wire format (summary)

```
[ HEADER  256 bytes fixed ]
[ CHUNK 0  16-byte header + payload ]
[ CHUNK 1  … ]
…
```

- Integers: **big-endian**
- Floats: **IEEE 754**
- Each chunk carries its own size + CRC-32

Canonical implementation:

- Spec text: `docs/` / `engine-next/docs/NIF_SPEC_v1.0.md`
- Browser/Node codec: `engine-next/format/NIFSpec.js`
- App bridge (encode from studio state): `js/modules/nif-format.js`

### Important chunk types (v1.1)

| ID | Name | Role |
|----|------|------|
| `0x0001` | META | JSON: title, author, capture info |
| `0x0002` | KEYFRAME_GEO | Gaussian / point field (14-float layout) |
| `0x0014` | PRINT_EXPORT | Print-ready mesh pack |
| `0x0015` | THUMBNAIL | JPEG poster |
| `0x0017` | CALIBRATION | Capture calibration |
| `0x0018` | VERIFICATION | Integrity / pipeline marks |
| `0x0020` | CERT | Encoder license tier |
| `0x0300` | SPATIAL_AUDIO | Shared with SPAX |
| `0x0500` | EDIT_HISTORY | Shared with SPAX |
| `0x0600` | INTERACTION | Hotspots / paths |

Full enum and layout: `engine-next/format/NIFSpec.js`.

---

## How FUMOCA uses NIF

1. **Capture / process** → splat or NIF on storage  
2. **Studio** → clean, mesh, camera paths, break-frame exports  
3. **Publish** → prefer writing `.nif` via `nif-format.js` when ready  
4. **Viewer / embed** → load by `splatId`; when `metadata.nif_url` exists, `?nif=1` prefers NIF  

Embeds:

```html
<iframe
  src="https://YOUR_DOMAIN/embed/player.html?splatId=UUID"
  style="width:100%;aspect-ratio:9/16;border:0;border-radius:12px"
  allow="autoplay; fullscreen; web-share"
  allowfullscreen
  loading="lazy"
></iframe>
```

Or token-based (origin-restricted) embeds via the `embeds` table + `?token=…`.

---

## Compatibility

| Asset | Support |
|-------|---------|
| `.nif` | Canonical format going forward |
| `.ply` / `.splat` | Supported for import and transitional publish |
| `.spax` | Related experimental container (`SPAXSpec.js`); shared chunk IDs for audio/history/interaction |

---

## Client one-liner

> **NIF is the PDF of space** — one file for view, share, embed, and print-ready geometry, with a free reader ecosystem and licensed encoding.
