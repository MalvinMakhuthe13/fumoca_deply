# FUMOCA Presentations

**`present.html`** turns a 3D capture into a PowerPoint-like interactive deck.

## For presenters
1. Open the scene in **Studio → Present**
2. Save camera angles (each angle = a slide)
3. Click **Open as presentation** or visit `present.html?splatId=…`
4. Fullscreen (`F`), advance with `→` / Space, notes with `N`

## For PowerPoint / Google Slides / Keynote
Insert a **web viewer / iframe** pointing at:

```
https://YOUR_DOMAIN/present.html?splatId=UUID
```

The scene stays interactive inside the slide: orbit still works; slide buttons change the hero angle.

## For embeds on sites
Same URL as a full-page presentation, or pair with `embed/player.html` for social chrome.

## Slide data
- Stored as camera bookmarks (see `js/modules/camera-paths.js`)
- Can be passed as `?slides=` JSON for headless decks
- Later: persisted on `splats.metadata.presentation` / NIF interaction chunk
