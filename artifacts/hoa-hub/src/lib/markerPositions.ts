export type Pos = { left: number; top: number };
export type ViewKey = "plat" | "satellite" | "roadmap";
export type ViewPositions = Record<number, Pos>;
export type AllPositions = Record<ViewKey, ViewPositions>;

export type ServerMarker = { buildingNum: number; view: string; left: number; top: number };

// Plat positions match the pre-rotated landscape image (no CSS rotation applied)
export const defaultPositions: AllPositions = {
  plat: {
    1:  { left: 5,  top: 57 },
    2:  { left: 5,  top: 37 },
    3:  { left: 12, top: 12 },
    4:  { left: 28, top: 12 },
    5:  { left: 44, top: 12 },
    6:  { left: 57, top: 12 },
    7:  { left: 74, top: 12 },
    8:  { left: 83, top: 30 },
    9:  { left: 58, top: 30 },
    10: { left: 38, top: 30 },
    11: { left: 22, top: 30 },
    12: { left: 18, top: 45 },
    13: { left: 30, top: 45 },
    14: { left: 46, top: 50 },
    15: { left: 82, top: 45 },
    16: { left: 84, top: 58 },
    17: { left: 87, top: 76 },
    18: { left: 68, top: 79 },
    19: { left: 52, top: 79 },
    20: { left: 68, top: 68 },
    21: { left: 55, top: 68 },
    22: { left: 38, top: 68 },
    23: { left: 30, top: 57 },
    24: { left: 18, top: 57 },
    25: { left: 16, top: 69 },
  },
  satellite: {
    1:  { left: 23, top: 14 },
    2:  { left: 43, top: 14 },
    3:  { left: 78, top: 14 },
    4:  { left: 80, top: 27 },
    5:  { left: 82, top: 41 },
    6:  { left: 82, top: 56 },
    7:  { left: 82, top: 70 },
    8:  { left: 71, top: 68 },
    9:  { left: 70, top: 55 },
    10: { left: 61, top: 37 },
    11: { left: 70, top: 26 },
    12: { left: 53, top: 22 },
    13: { left: 53, top: 38 },
    14: { left: 46, top: 50 },
    15: { left: 51, top: 64 },
    16: { left: 37, top: 73 },
    17: { left: 11, top: 80 },
    18: { left: 9,  top: 63 },
    19: { left: 17, top: 51 },
    20: { left: 22, top: 65 },
    21: { left: 25, top: 53 },
    22: { left: 18, top: 40 },
    23: { left: 40, top: 38 },
    24: { left: 35, top: 25 },
    25: { left: 24, top: 26 },
  },
  roadmap: {
    1:  { left: 23, top: 14 },
    2:  { left: 43, top: 14 },
    3:  { left: 78, top: 14 },
    4:  { left: 80, top: 27 },
    5:  { left: 82, top: 41 },
    6:  { left: 82, top: 56 },
    7:  { left: 82, top: 70 },
    8:  { left: 71, top: 68 },
    9:  { left: 70, top: 55 },
    10: { left: 61, top: 37 },
    11: { left: 70, top: 26 },
    12: { left: 53, top: 22 },
    13: { left: 53, top: 38 },
    14: { left: 46, top: 50 },
    15: { left: 51, top: 64 },
    16: { left: 37, top: 73 },
    17: { left: 11, top: 80 },
    18: { left: 9,  top: 63 },
    19: { left: 17, top: 51 },
    20: { left: 22, top: 65 },
    21: { left: 25, top: 53 },
    22: { left: 18, top: 40 },
    23: { left: 40, top: 38 },
    24: { left: 35, top: 25 },
    25: { left: 24, top: 26 },
  },
};

const STORAGE_KEY = "hoa_hub_marker_positions";

export function loadPositions(): AllPositions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AllPositions>;
      return {
        plat:      { ...defaultPositions.plat,      ...(parsed.plat      ?? {}) },
        satellite: { ...defaultPositions.satellite,  ...(parsed.satellite ?? {}) },
        roadmap:   { ...defaultPositions.roadmap,    ...(parsed.roadmap   ?? {}) },
      };
    }
  } catch {}
  return { ...defaultPositions };
}

export function mergeServerMarkers(markers: ServerMarker[]): AllPositions {
  const result: AllPositions = {
    plat:      { ...defaultPositions.plat },
    satellite: { ...defaultPositions.satellite },
    roadmap:   { ...defaultPositions.roadmap },
  };
  for (const m of markers) {
    const view = m.view as ViewKey;
    if (view === "plat" || view === "satellite" || view === "roadmap") {
      result[view][m.buildingNum] = { left: m.left, top: m.top };
    }
  }
  return result;
}

export function savePositions(positions: AllPositions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {}
}

export function resetView(positions: AllPositions, view: ViewKey): AllPositions {
  return { ...positions, [view]: { ...defaultPositions[view] } };
}
