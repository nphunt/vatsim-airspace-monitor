// Canvas mirror of the CSS tokens in eram.css. Keep in sync; colors.test.ts checks it.

export const ERAM_COLORS = {
  bg: "#000000",
  toolbarBtn: "#004848",
  toolbarText: "#e0e0e0",
  toolbarActive: "#00a0a0",
  windowBorder: "#808080",
  text: "#d0d0d0",
  datablock: "#e0e0e0",
  datablockDim: "#7a7a7a",
  mapOwn: "#5a7da0",
  mapOther: "#3a3a3a",
  alert: "#ff3030",
  caution: "#ffd000",
  handoff: "#ff8c00",
} as const;

export type EramColor = keyof typeof ERAM_COLORS;
