// Named colour presets (sRGB hex).
export const LEATHER_PRESETS = [
  { name: 'Classic Tan', hex: '#C68E4E' },
  { name: 'Black', hex: '#141414' },
  { name: 'Red', hex: '#B3191F' },
  { name: 'Navy', hex: '#14213D' },
  { name: 'Royal Blue', hex: '#1D4FA8' },
  { name: 'Green', hex: '#1E5631' },
  { name: 'White', hex: '#F2F0EB' },
  { name: 'Brown', hex: '#5A3620' },
  { name: 'Orange', hex: '#D9601C' },
  { name: 'Yellow', hex: '#E8B820' },
  { name: 'Grey', hex: '#7A7C80' },
  { name: 'Purple', hex: '#4B2A7B' },
];

export const LACE_PRESETS = [
  { name: 'Black', hex: '#141414' },
  { name: 'Classic Tan', hex: '#C68E4E' },
  { name: 'White', hex: '#F2F0EB' },
  { name: 'Red', hex: '#B3191F' },
  { name: 'Navy', hex: '#14213D' },
  { name: 'Royal Blue', hex: '#1D4FA8' },
  { name: 'Brown', hex: '#5A3620' },
  { name: 'Orange', hex: '#D9601C' },
];

export const LINER_PRESETS = [
  { name: 'Black', hex: '#141414' },
  { name: 'Classic Tan', hex: '#C68E4E' },
  { name: 'White', hex: '#F2F0EB' },
  { name: 'Red', hex: '#B3191F' },
  { name: 'Navy', hex: '#14213D' },
  { name: 'Grey', hex: '#7A7C80' },
];

export const BRAND_PRESETS = [
  { name: 'White', hex: '#F7F7F5' },
  { name: 'Black', hex: '#111111' },
  { name: 'Metallic Gold', hex: '#C9A227' },
  { name: 'Silver', hex: '#B8BCC2' },
  { name: 'Red', hex: '#C62828' },
  { name: 'Navy', hex: '#123B75' },
  { name: 'Volt', hex: '#D4E80F' },
];

export const BACKGROUND_PRESETS = [
  { name: 'Studio Dark', hex: '#111111' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Light Grey', hex: '#E9E9EA' },
  { name: 'Slate', hex: '#2A2F36' },
];

// QA colour-test grid (requirement: same glove rendered in each colour).
export const TEST_GRID_COLORS = [
  { name: 'White', hex: '#F2F0EB' },
  { name: 'Red', hex: '#C62828' },
  { name: 'Blue', hex: '#1D4FA8' },
  { name: 'Green', hex: '#2E7D32' },
  { name: 'Yellow', hex: '#F2C200' },
  { name: 'Orange', hex: '#E8641B' },
  { name: 'Brown', hex: '#5A3620' },
  { name: 'Black', hex: '#000000' },
  { name: 'Purple', hex: '#5E35B1' },
];

export const DEFAULT_CONFIG = {
  leather: '#C68E4E',
  binding: '#141414',
  laces: '#C68E4E',
  liner: '#141414',
  swoosh: '#111111',
  stitching: '#F7F7F5',
  embroidery: '#111111',
  swooshBase: '#141414',
  background: '#111111',
  backgroundMode: 'solid', // 'solid' | 'transparent'
  panels: {}, // per-panel leather overrides, e.g. { BOH: '#14213D' }
};
