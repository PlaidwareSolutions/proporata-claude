import { useRef, useState, useCallback, useEffect } from "react";
import { c, statusColor } from "@/lib/theme";
import type { Building } from "@/lib/data";
import { loadPositions, type ViewKey, type ViewPositions, type AllPositions } from "@/lib/markerPositions";
import type { MapLayers } from "@/contexts/MapLayersContext";

export type MapView = "schematic" | "plat" | "satellite" | "roadmap";

type Props = {
  view: Exclude<MapView, "schematic">;
  selectedNum: number;
  onSelect: (num: number) => void;
  onNavigate?: (num: number) => void;
  showNumbers: boolean;
  /**
   * Maximum height in px.
   * - Inline mode (no maxWidth): container height = containerWidth / imgAspect,
   *   clamped to [minHeight, maxHeight]. Frame matches image — no dead bands.
   * - Fullscreen mode (maxWidth also provided): container is sized to the
   *   largest rect that fits within maxWidth × maxHeight while preserving
   *   the image's natural aspect ratio. No dead bands in either dimension.
   */
  maxHeight?: number;
  /**
   * Maximum width in px. When provided together with maxHeight, the component
   * constrains itself to the image's natural aspect ratio within both bounds,
   * eliminating dead space in fullscreen overlays.
   */
  maxWidth?: number;
  minHeight?: number;
  buildings?: Building[];
  /** Optional override — used by Settings editor preview. Falls back to localStorage. */
  customPositions?: ViewPositions;
  /** Full positions from the server (used by Site Map page). Takes priority over localStorage. */
  allPositions?: AllPositions;
  layers?: MapLayers;
};

type RenderedRect = { left: number; top: number; width: number; height: number };

/**
 * Computes the pixel rect of the image rendered by CSS `object-contain` inside
 * a container of (containerW × containerH). Used to keep marker pins anchored
 * to the correct image coordinates even when the container is letterboxed.
 */
function computeContainRect(
  containerW: number,
  containerH: number,
  naturalW: number,
  naturalH: number,
): RenderedRect {
  if (!naturalW || !naturalH) {
    return { left: 0, top: 0, width: containerW, height: containerH };
  }
  const containerAspect = containerW / containerH;
  const imgAspect = naturalW / naturalH;
  let renderedW: number, renderedH: number;
  if (imgAspect > containerAspect) {
    renderedW = containerW;
    renderedH = containerW / imgAspect;
  } else {
    renderedH = containerH;
    renderedW = containerH * imgAspect;
  }
  return {
    left: (containerW - renderedW) / 2,
    top: (containerH - renderedH) / 2,
    width: renderedW,
    height: renderedH,
  };
}

const DEFAULT_LAYERS: MapLayers = {
  buildings: true,
  openWO: true,
  insuranceGaps: true,
  roofStatus: false,
};

const ROOF_AGE_THRESHOLD = 12;
const REFERENCE_YEAR = 2026;

export function ImageMap({
  view,
  selectedNum,
  onSelect,
  onNavigate,
  showNumbers,
  maxHeight = 700,
  maxWidth,
  minHeight = 280,
  buildings = [],
  customPositions,
  allPositions,
  layers = DEFAULT_LAYERS,
}: Props) {
  const isPlatDoc = view === "plat";
  const allStored = allPositions ?? loadPositions();
  const positions = customPositions ?? allStored[view as ViewKey];
  const showMarkers = showNumbers && layers.buildings;

  const imgSrc = isPlatDoc
    ? "/maps/plat.png"
    : view === "satellite"
      ? "/maps/satellite.png"
      : "/maps/roadmap.png";

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });

  const measureContainer = useCallback(() => {
    const el = containerRef.current;
    if (el) setContainerW(el.clientWidth);
  }, []);

  useEffect(() => {
    measureContainer();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measureContainer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureContainer]);

  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) {
      setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [view]);

  // Compute container dimensions.
  // Dual-constraint mode (fullscreen): fit within maxWidth × maxHeight while
  // preserving image aspect ratio — container matches rendered image exactly.
  // Single-constraint mode (inline): derive height from container width.
  let actualW: number | string;
  let actualH: number;

  if (maxWidth && imgNatural.w > 0) {
    // Both bounds given — compute largest fit with preserved aspect ratio.
    const scaleW = maxWidth / imgNatural.w;
    const scaleH = maxHeight / imgNatural.h;
    const scale = Math.min(scaleW, scaleH);
    actualW = Math.round(imgNatural.w * scale);
    actualH = Math.round(imgNatural.h * scale);
  } else if (imgNatural.w > 0 && containerW > 0) {
    // Only height bound — derive height from container width so image fills
    // full width with no side bands.
    actualW = "100%";
    actualH = Math.max(minHeight, Math.min(maxHeight, containerW * (imgNatural.h / imgNatural.w)));
  } else {
    // Not yet measured — hold a placeholder.
    actualW = "100%";
    actualH = minHeight;
  }

  // Always compute the true rendered image rect using object-contain math so
  // marker pins stay aligned even when the container is letterboxed (e.g. when
  // the inline maxHeight cap is hit at unusually wide layouts).
  const resolvedW = typeof actualW === "number" ? actualW : containerW;
  const markerRect: RenderedRect =
    imgNatural.w > 0 && resolvedW > 0
      ? computeContainRect(resolvedW, actualH, imgNatural.w, imgNatural.h)
      : { left: 0, top: 0, width: resolvedW, height: actualH };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-lg select-none"
      style={{
        width: actualW,
        height: actualH,
        background: isPlatDoc ? "#F5F0E8" : "#2B3A52",
        transition: "width 0.15s ease, height 0.15s ease",
      }}
    >
      <img
        ref={imgRef}
        src={imgSrc}
        alt={isPlatDoc ? "Official plat map" : view === "satellite" ? "Satellite view" : "Road map"}
        className="absolute inset-0 w-full h-full object-contain"
        draggable={false}
        onLoad={handleImgLoad}
      />

      {showMarkers && imgNatural.w > 0 && buildings.map((b) => {
        const pos = positions[b.num];
        if (!pos) return null;
        const isSelected = b.num === selectedNum;
        const color = statusColor[b.status];
        const bg =
          b.status === "urgent" ? c.rose :
          b.status === "watch"  ? c.amber : c.emerald;
        const insuranceGap = b.insuranceStatus !== "current";
        const roofOld = REFERENCE_YEAR - b.roofYear >= ROOF_AGE_THRESHOLD;
        const showInsRing = layers.insuranceGaps && insuranceGap;
        const showRoofRing = layers.roofStatus && roofOld;
        const showWODot = layers.openWO && b.openWO > 0;
        const ringShadow = showInsRing ? `0 0 0 2px ${c.amber}` : "";
        const baseShadow = isSelected
          ? `0 0 0 3px white, 0 0 0 5px ${bg}`
          : `0 1px 4px rgba(0,0,0,0.5)`;
        const shadow = [baseShadow, ringShadow].filter(Boolean).join(", ");
        const scale = isSelected
          ? "translate(-50%, -50%) scale(1.18)"
          : "translate(-50%, -50%)";

        const markerLeft = markerRect.left + (pos.left / 100) * markerRect.width;
        const markerTop  = markerRect.top  + (pos.top  / 100) * markerRect.height;

        return (
          <div
            key={b.num}
            style={{
              position: "absolute",
              left: markerLeft,
              top: markerTop,
              transform: scale,
              zIndex: isSelected ? 20 : 10,
            }}
          >
            <button
              onClick={() => { onSelect(b.num); onNavigate?.(b.num); }}
              title={`Building ${b.num} — ${b.address}`}
              style={{
                position: "relative",
                boxShadow: shadow,
                background: isSelected ? bg : isPlatDoc ? "rgba(255,255,255,0.92)" : "rgba(11,16,32,0.82)",
                border: showRoofRing ? `2px dashed ${c.amber}` : `2px solid ${bg}`,
                borderRadius: 6,
                minWidth: 26,
                height: 22,
                padding: "0 5px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "box-shadow 0.15s, transform 0.1s",
              }}
            >
              <span style={{
                fontSize: 10.5,
                fontWeight: 800,
                fontFamily: "'Inter Tight', system-ui, sans-serif",
                letterSpacing: "-0.01em",
                color: isSelected ? "#fff" : isPlatDoc ? color : "#fff",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}>
                {b.num}
              </span>
              {showWODot && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c.rose,
                    border: "1.5px solid #fff",
                  }}
                />
              )}
            </button>
          </div>
        );
      })}

      <div
        className="absolute bottom-2 right-2 flex items-center gap-2 rounded-md px-2.5 py-1.5"
        style={{ background: "rgba(11,16,32,0.75)", backdropFilter: "blur(4px)" }}
      >
        {[
          { label: "Healthy", color: c.emerald },
          { label: "Watch",   color: c.amber },
          { label: "Urgent",  color: c.rose },
        ].map((l) => (
          <span key={l.label} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm inline-block" style={{ background: l.color }} />
            <span style={{ fontSize: 10.5, color: "#C8CEDF", fontWeight: 600 }}>{l.label}</span>
          </span>
        ))}
      </div>

      {!isPlatDoc && (
        <div
          className="absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[9.5px]"
          style={{ background: "rgba(255,255,255,0.85)", color: "#555", fontFamily: "sans-serif" }}
        >
          © Google Maps
        </div>
      )}
    </div>
  );
}
