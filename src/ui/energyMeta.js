// energyMeta.js — the playful, seaside face of the load axes (design/ENERGY-MODEL.md).
// The engine keeps the plain names (mental/physical/social/creative); this just
// puts a critter on each so the Cabana is a bit more fun. Swap the glyphs freely.
import { LOAD_AXES } from '../core/index.js';

export const AXES = LOAD_AXES; // ['mental','physical','social','creative']

export const AXIS_META = {
  mental: { label: 'mental', glyph: '🐦' }, // seagull — heady, up in the air
  physical: { label: 'physical', glyph: '🐬' }, // dolphin — all body
  social: { label: 'social', glyph: '🐠' }, // a little fish (they school)
  creative: { label: 'creative', glyph: '🦀' }, // crab — the maker
};
