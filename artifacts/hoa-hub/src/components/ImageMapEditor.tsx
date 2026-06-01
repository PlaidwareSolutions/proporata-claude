import { useRef, useState, useCallback } from "react";
import { c, statusColor } from "@/lib/theme";
import type { Building } from "@/lib/data";
import { type ViewKey, type ViewPositions } from "@/lib/markerPositions";

type Props = {
  view: ViewKey;
  positions: ViewPositions;
  onChange: (positions: ViewPositions) => void;
  height?: number;
  buildings?: Building[];
};

const IMG_SRC: Record<ViewKey, string> = {
  plat:      "/maps/plat.png",
  satellite: "/maps/satellite.png",
  roadmap:   "/maps/roadmap.png",
};

export function ImageMapEditor({ view, positions, onChange, height = 460, buildings = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // offset from marker center to pointer, in % units
  const dragOffset = useRef({ dx: 0, dy: 0 });

  const isPlatDoc = view === "plat";

  const getPct = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width)  * 100,
      y: ((e.clientY - rect.top)  / rect.height) * 100,
    };
  }, []);

  function onMarkerMouseDown(e: React.MouseEvent, num: number) {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = getPct(e);
    const pos = positions[num];
    dragOffset.current = { dx: x - pos.left, dy: y - pos.top };
    setDragging(num);
  }

  function onContainerMouseMove(e: React.MouseEvent) {
    if (dragging === null) return;
    const { x, y } = getPct(e);
    const newLeft = Math.max(1, Math.min(99, x - dragOffset.current.dx));
    const newTop  = Math.max(1, Math.min(99, y - dragOffset.current.dy));
    onChange({ ...positions, [dragging]: { left: newLeft, top: newTop } });
  }

  function onContainerMouseUp() {
    setDragging(null);
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border select-none w-full"
      style={{
        height,
        borderColor: c.border,
        background: isPlatDoc ? "#F5F0E8" : "#2B3A52",
        cursor: dragging !== null ? "grabbing" : "default",
      }}
      onMouseMove={onContainerMouseMove}
      onMouseUp={onContainerMouseUp}
      onMouseLeave={onContainerMouseUp}
    >
      {/* Background image */}
      <img src={IMG_SRC[view]} alt={view}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", pointerEvents: "none" }}
        draggable={false}
      />

      {/* Edit-mode watermark */}
      <div
        className="absolute top-2 right-2 rounded-md px-2 py-1 text-[11px]"
        style={{ background: "rgba(11,16,32,0.65)", color: "rgba(255,255,255,0.7)", fontWeight: 600, backdropFilter: "blur(4px)" }}
      >
        Drag to reposition
      </div>

      {/* Draggable markers */}
      {buildings.map((b) => {
        const pos = positions[b.num];
        if (!pos) return null;
        const isDragging = dragging === b.num;
        const bg =
          b.status === "urgent" ? c.rose :
          b.status === "watch"  ? c.amber : c.emerald;
        const textColor = statusColor[b.status];

        return (
          <div
            key={b.num}
            onMouseDown={(e) => onMarkerMouseDown(e, b.num)}
            style={{
              position: "absolute",
              left: `${pos.left}%`,
              top:  `${pos.top}%`,
              transform: `translate(-50%, -50%) scale(${isDragging ? 1.2 : 1})`,
              zIndex: isDragging ? 30 : 10,
              cursor: "grab",
              transition: isDragging ? "none" : "transform 0.1s",
              userSelect: "none",
            }}
          >
            <div style={{
              background: isDragging ? bg : isPlatDoc ? "rgba(255,255,255,0.95)" : "rgba(11,16,32,0.85)",
              border: `2px solid ${bg}`,
              borderRadius: 6,
              minWidth: 30,
              height: 24,
              padding: "0 6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              boxShadow: isDragging
                ? `0 0 0 3px white, 0 0 0 5px ${bg}, 0 4px 12px rgba(0,0,0,0.4)`
                : "0 1px 5px rgba(0,0,0,0.45)",
            }}>
              {/* grip dots */}
              <svg width="6" height="10" viewBox="0 0 6 10" fill={isDragging ? "rgba(255,255,255,0.7)" : "#9098B8"}>
                <circle cx="1.5" cy="2" r="1.2" />
                <circle cx="4.5" cy="2" r="1.2" />
                <circle cx="1.5" cy="5" r="1.2" />
                <circle cx="4.5" cy="5" r="1.2" />
                <circle cx="1.5" cy="8" r="1.2" />
                <circle cx="4.5" cy="8" r="1.2" />
              </svg>
              <span style={{
                fontSize: 11,
                fontWeight: 800,
                fontFamily: "'Inter Tight', system-ui, sans-serif",
                letterSpacing: "-0.01em",
                color: isDragging ? "#fff" : isPlatDoc ? textColor : "#fff",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}>
                {b.num}
              </span>
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div
        className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md px-2.5 py-1.5"
        style={{ background: "rgba(11,16,32,0.72)", backdropFilter: "blur(4px)" }}
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
    </div>
  );
}
