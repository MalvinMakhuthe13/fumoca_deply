/**
 * FUMOCA Present Tab — all Present tools live in the Present sidebar section
 * Magazine text · Nav · Review video · Save / share (keeps text for viewer)
 */
import {
  initMagazineText, addText, updateText, removeText, applyPreset, clearText,
  exportAll as exportMagazine, importAll as importMagazine, setEditable as setMagEditable, selectText, getSelectedTextId, moveTextLayer,
} from './present-magazine-text.js?v=20261107-canvasresize01';
