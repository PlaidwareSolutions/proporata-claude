import { useState } from "react";
import { c, statusColor } from "@/lib/theme";
import type { Building } from "@/lib/data";
import { pins } from "@/lib/mapConstants";
import type { MapLayers } from "@/contexts/MapLayersContext";

type Props = {
  selectedNum?: number;
  onSelect?: (num: number) => void;
  onNavigate?: (num: number) => void;
  height?: number;
  buildings?: Building[];
  layers?: MapLayers;
};

const DEFAULT_LAYERS: MapLayers = {
  buildings: true,
  openWO: true,
  insuranceGaps: true,
  roofStatus: false,
};

const ROOF_AGE_THRESHOLD = 12;
const REFERENCE_YEAR = 2026;

function buildingAriaLabel(b: Building): string {
  const statusText =
    b.status === "urgent" ? "Urgent" : b.status === "watch" ? "Watch" : "Healthy";
  const woText =
    b.openWO === 0
      ? "no open work orders"
      : b.openWO === 1
        ? "1 open work order"
        : `${b.openWO} open work orders`;
  return `Building ${b.num} — ${statusText}, ${woText}`;
}

export function PlatMap({ selectedNum, onSelect, onNavigate, height = 480, buildings = [], layers = DEFAULT_LAYERS }: Props) {
  const [focusedNum, setFocusedNum] = useState<number | null>(null);
  // Layer semantics: when `buildings` is off, all building-attached overlays
  // (open WO badges/pins, insurance gap rings, roof status rings) render no-ops
  // since there's nothing to annotate. Roads, road labels, and the compass stay.

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{ background: c.mapBg, height }}
    >
      <svg
        viewBox="0 0 600 460"
        className="absolute inset-0 h-full w-full"
        data-testid="plat-map-svg"
        aria-label="Interactive plat map of The Town Homes of Quail Valley"
      >
        <defs>
          <pattern id="grid-cv2" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={c.mapGrid} strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="600" height="460" fill="url(#grid-cv2)" role="presentation" />
        <ellipse cx="540" cy="80" rx="50" ry="40" fill={c.mapGreen} opacity="0.7" role="presentation" />
        <ellipse cx="540" cy="380" rx="60" ry="50" fill={c.mapGreen} opacity="0.7" role="presentation" />
        <ellipse cx="40" cy="420" rx="50" ry="35" fill={c.mapGreen} opacity="0.7" role="presentation" />
        <path d="M 0 122 L 600 122" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" role="presentation" />
        <path d="M 0 207 L 600 207" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" role="presentation" />
        <path d="M 0 272 L 600 272" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" role="presentation" />
        <path d="M 0 337 L 600 337" stroke="#2A3460" strokeWidth="14" strokeLinecap="round" role="presentation" />
        <path d="M 510 0 Q 530 230 510 460" stroke="#2A3460" strokeWidth="12" fill="none" role="presentation" />
        {[
          { y: 116, t: "CAMBRIDGE LN" },
          { y: 201, t: "HAMPSHIRE LN" },
          { y: 266, t: "PRINCETON LN" },
          { y: 331, t: "W HAMPTON LN" },
        ].map((l) => (
          <text
            key={l.t}
            x="10"
            y={l.y - 4}
            fontSize="10"
            fontWeight="600"
            fill="#9098B8"
            fontFamily="Inter Tight"
            letterSpacing="0.5"
            aria-hidden="true"
          >
            {l.t}
          </text>
        ))}
        {layers.buildings && buildings.map((b) => {
          const isSel = b.num === selectedNum;
          const isFocused = b.num === focusedNum;
          const label = buildingAriaLabel(b);
          const insuranceGap = b.insuranceStatus !== "current";
          const roofOld = REFERENCE_YEAR - b.roofYear >= ROOF_AGE_THRESHOLD;
          return (
            <g
              key={b.num}
              data-testid={`map-building-${b.num}`}
            >
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx="4"
                fill={isSel ? c.cobalt : "#FFFFFF"}
                fillOpacity={isSel ? 1 : 0.95}
                stroke={statusColor[b.status]}
                strokeWidth={isSel ? 2.5 : 1.6}
                style={{ pointerEvents: "none" }}
                aria-hidden="true"
              />
              {layers.insuranceGaps && insuranceGap && (
                <rect
                  x={b.x - 3}
                  y={b.y - 3}
                  width={b.w + 6}
                  height={b.h + 6}
                  rx="6"
                  fill="none"
                  stroke={c.amber}
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                  aria-hidden="true"
                />
              )}
              {layers.roofStatus && roofOld && (
                <rect
                  x={b.x - 5}
                  y={b.y - 5}
                  width={b.w + 10}
                  height={b.h + 10}
                  rx="7"
                  fill="none"
                  stroke={c.amber}
                  strokeWidth="1.8"
                  strokeDasharray="4 3"
                  style={{ pointerEvents: "none" }}
                  aria-hidden="true"
                />
              )}
              <text
                x={b.x + b.w / 2}
                y={b.y + b.h / 2 + 5}
                textAnchor="middle"
                fontSize="16"
                fontFamily="Inter Tight"
                fontWeight="800"
                fill={isSel ? "#fff" : c.ink}
                letterSpacing="-0.02em"
                style={{ pointerEvents: "none" }}
                aria-hidden="true"
              >
                {b.num}
              </text>
              <circle
                cx={b.x + b.w - 7}
                cy={b.y + 7}
                r="3.5"
                fill={statusColor[b.status]}
                style={{ pointerEvents: "none" }}
                aria-hidden="true"
              />
              {layers.openWO && b.openWO > 0 && (
                <g style={{ pointerEvents: "none" }} aria-hidden="true">
                  <rect
                    x={b.x + 4}
                    y={b.y + b.h - 13}
                    width="16"
                    height="10"
                    rx="2.5"
                    fill={statusColor[b.status]}
                    fillOpacity="0.22"
                  />
                  <text
                    x={b.x + 12}
                    y={b.y + b.h - 5}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="JetBrains Mono"
                    fontWeight="700"
                    fill={statusColor[b.status]}
                  >
                    {b.openWO}
                  </text>
                </g>
              )}
              {isFocused && (
                <rect
                  x={b.x - 2}
                  y={b.y - 2}
                  width={b.w + 4}
                  height={b.h + 4}
                  rx="6"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  style={{ pointerEvents: "none" }}
                  aria-hidden="true"
                />
              )}
              <rect
                role="button"
                tabIndex={onSelect ? 0 : -1}
                aria-label={label}
                aria-pressed={isSel}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx="4"
                fill="transparent"
                style={{
                  cursor: onSelect ? "pointer" : "default",
                  outline: "none",
                }}
                onClick={() => { onSelect?.(b.num); onNavigate?.(b.num); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect?.(b.num);
                    onNavigate?.(b.num);
                  }
                }}
                onFocus={() => setFocusedNum(b.num)}
                onBlur={() => setFocusedNum(null)}
              />
            </g>
          );
        })}
        {layers.buildings && layers.openWO && pins.map((p) => {
          const b = buildings.find((bb) => bb.num === p.num);
          if (!b) return null;
          return (
            <g key={p.num} style={{ pointerEvents: "none" }} aria-hidden="true">
              <circle
                cx={b.x + b.w / 2}
                cy={b.y + b.h / 2}
                r="6"
                fill={c.rose}
                className="pulse-ring"
                style={{
                  transformOrigin: `${b.x + b.w / 2}px ${b.y + b.h / 2}px`,
                }}
              />
            </g>
          );
        })}
        <g transform="translate(560, 30)" role="presentation" aria-hidden="true">
          <circle r="16" fill="#1A2140" stroke="#2A3460" />
          <text
            y="-3"
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill="#C8CDE3"
            fontFamily="Inter Tight"
          >
            N
          </text>
          <path d="M 0 -9 L 4 5 L 0 1 L -4 5 Z" fill={c.cobalt} />
        </g>
      </svg>
    </div>
  );
}
