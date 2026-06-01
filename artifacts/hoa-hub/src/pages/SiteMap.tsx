import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Map, Maximize2, Minimize2, Wrench, Droplets, ShieldAlert, ArrowRight,
  Eye, EyeOff, ScanSearch, Satellite, Navigation,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { PlatMap } from "@/components/PlatMap";
import { ImageMap, type MapView } from "@/components/ImageMap";
import { c, statusColor } from "@/lib/theme";
import { pins } from "@/lib/mapConstants";
import { useListBuildings, useListWorkOrders, useListMarkers } from "@workspace/api-client-react";
import { mergeServerMarkers } from "@/lib/markerPositions";
import { useMapLayers } from "@/contexts/MapLayersContext";

const iconMap = { shield: ShieldAlert, drop: Droplets, wrench: Wrench };

const VIEW_OPTS: { key: MapView; label: string; Icon: React.ElementType }[] = [
  { key: "plat",      label: "Plat",  Icon: Map },
  { key: "roadmap",   label: "RoadMap",  Icon: Navigation },
  { key: "satellite", label: "Satellite", Icon: Satellite },
  { key: "schematic", label: "Schematic", Icon: ScanSearch },
];

export default function SiteMap() {
  const [selectedNum, setSelectedNum] = useState<number>(9);
  const [mapView, setMapView] = useState<MapView>("plat");
  const [showNumbers, setShowNumbers] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [winSize, setWinSize] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  const [, navigate] = useLocation();

  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  const { data: buildings = [] } = useListBuildings();
  const { data: workOrders = [] } = useListWorkOrders();
  const { data: serverMarkers = [] } = useListMarkers();
  const { layers } = useMapLayers();

  const markerPositions = useMemo(() => mergeServerMarkers(serverMarkers), [serverMarkers]);

  const selected = buildings.find((b) => b.num === selectedNum) ?? buildings[0];
  const selWOs = workOrders.filter((w) => w.building === selectedNum && w.status !== "done");

  const totalUnits = buildings.reduce((s, b) => s + b.units, 0);
  const openWO = workOrders.filter((w) => w.status !== "done").length;
  const urgent = workOrders.filter((w) => w.priority === "urgent" && w.status !== "done").length;
  const insuranceGaps = buildings.filter((b) => b.insuranceStatus !== "current").length;
  const roofAttention = buildings.filter((b) => 2026 - b.roofYear >= 12).length;
  const healthy = buildings.filter((b) => b.status === "good").length;
  const watch = buildings.filter((b) => b.status === "watch").length;
  const urgentBldgs = buildings.filter((b) => b.status === "urgent").length;

  const renderMapToolbar = () => (
    <div className="mb-2 flex items-center justify-between px-1 py-0.5 gap-3">
      <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "rgba(255,255,255,0.08)" }}>
        {VIEW_OPTS.map(({ key, label, Icon }) => {
          const active = mapView === key;
          return (
            <button
              key={key}
              onClick={() => setMapView(key)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] transition-colors"
              style={
                active
                  ? { background: "#fff", color: c.ink, fontWeight: 700 }
                  : { color: "rgba(255,255,255,0.7)", fontWeight: 500 }
              }
            >
              <Icon style={{ height: 13, width: 13 }} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5">
        {mapView !== "schematic" && (
          <button
            onClick={() => setShowNumbers((v) => !v)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors"
            style={{ background: showNumbers ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)", fontWeight: 600 }}
          >
            {showNumbers ? <Eye style={{ height: 13, width: 13 }} /> : <EyeOff style={{ height: 13, width: 13 }} />}
            {showNumbers ? "Hide labels" : "Show labels"}
          </button>
        )}

        {mapView === "schematic" && (
          <div className="flex items-center gap-3.5 text-[12.5px] text-white/85" style={{ fontWeight: 500 }}>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.emerald }} />
              Healthy <span className="font-mono-num font-semibold">{healthy}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.amber }} />
              Watch <span className="font-mono-num font-semibold">{watch}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.rose }} />
              Urgent <span className="font-mono-num font-semibold">{urgentBldgs}</span>
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          aria-label={isFullscreen ? "Exit fullscreen map" : "Expand map to fullscreen"}
          title={isFullscreen ? "Exit fullscreen (Esc)" : "Expand map"}
          className="flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-white/15"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          {isFullscreen
            ? <Minimize2 className="h-4 w-4" />
            : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  const renderMapBody = (maxHeight: number, maxWidth?: number) =>
    mapView === "schematic" ? (
      <PlatMap
        selectedNum={selectedNum}
        onSelect={setSelectedNum}
        buildings={buildings}
        height={maxHeight}
        layers={layers}
      />
    ) : (
      <ImageMap
        view={mapView}
        selectedNum={selectedNum}
        onSelect={setSelectedNum}
        showNumbers={showNumbers}
        maxHeight={maxHeight}
        maxWidth={maxWidth}
        buildings={buildings}
        allPositions={markerPositions}
        layers={layers}
      />
    );

  return (
    <Layout
      title="Site Map"
      subtitle={`The Town Homes of Quail Valley · ${buildings.length} buildings · ${totalUnits} units`}
      liveTag
    >
      <div
        className="mb-5 grid grid-cols-6 overflow-hidden rounded-xl border bg-white"
        style={{ borderColor: c.border }}
      >
        {[
          { l: "Total Units",     v: String(totalUnits) },
          { l: "Buildings",       v: String(buildings.length) },
          { l: "Open WO",         v: String(openWO),         a: c.cobalt },
          { l: "Urgent",          v: String(urgent),          a: c.rose },
          { l: "Insurance gaps",  v: String(insuranceGaps),   a: c.amber },
          { l: "Roof attention",  v: String(roofAttention),   a: c.amber },
        ].map((k, i) => (
          <div
            key={k.l}
            className="flex items-center justify-between px-4 py-3.5"
            style={{ borderRight: i < 5 ? `1px solid ${c.border}` : "none" }}
          >
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>{k.l}</div>
              <div className="font-mono-num mt-1 text-[26px] leading-none" style={{ color: k.a || c.ink, fontWeight: 700, letterSpacing: "-0.02em" }}>{k.v}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5 items-start">
        <section
          className="col-span-2 rounded-xl border p-3 shadow-sm"
          style={{ borderColor: c.border, background: c.mapBg }}
        >
          {renderMapToolbar()}
          {renderMapBody(640)}
        </section>

        <aside className="space-y-4">
          {selected && (
            <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
              <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>
                Selected building
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono-num text-[12.5px]" style={{ color: c.inkMute, fontWeight: 600 }}>
                    BLDG {String(selected.num).padStart(2, "0")}
                  </div>
                  <div className="text-[22px] mt-0.5" style={{ fontWeight: 700, letterSpacing: "-0.02em", color: c.ink }}>
                    {selected.address}
                  </div>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wider shrink-0"
                  style={{
                    background:
                      selected.status === "urgent" ? c.roseSoft :
                      selected.status === "watch"  ? c.amberSoft :
                      c.emeraldSoft,
                    color: statusColor[selected.status as "good" | "watch" | "urgent"],
                  }}
                >
                  {selected.status.toUpperCase()}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { v: String(selected.units),       l: "Units",     color: c.ink },
                  { v: String(selected.openWO),      l: "Open WO",   color: selected.openWO > 0 ? c.rose : c.ink },
                  {
                    v: selected.insuranceStatus === "current" ? "✓" : "!",
                    l: "Insurance",
                    color: selected.insuranceStatus === "missing" ? c.rose :
                           selected.insuranceStatus === "expiring" ? c.amber : c.ink,
                  },
                ].map((k) => (
                  <div key={k.l} className="rounded-lg border py-2.5" style={{ borderColor: c.borderSoft, background: c.canvas }}>
                    <div className="font-mono-num text-[22px] leading-none" style={{ fontWeight: 700, color: k.color }}>{k.v}</div>
                    <div className="text-[12px] mt-1" style={{ color: c.inkSoft, fontWeight: 500 }}>{k.l}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                <Row k="Roof" v={`${selected.roofYear} (${2026 - selected.roofYear}y)`}
                  color={2026 - selected.roofYear >= 12 ? c.amber : c.inkSoft} />
                <Row
                  k="Insurance"
                  v={selected.insuranceStatus === "missing" ? "Declaration missing" :
                     selected.insuranceStatus === "expiring" ? "Expiring soon" : "Current"}
                  color={selected.insuranceStatus === "missing" ? c.rose :
                         selected.insuranceStatus === "expiring" ? c.amber : c.emerald}
                />
                {selected.notes && <Row k="Active alert" v={selected.notes} color={c.rose} />}
                {selWOs[0] && (
                  <Row
                    k="Top WO"
                    v={selWOs[0].title.length > 28 ? selWOs[0].title.slice(0, 28) + "…" : selWOs[0].title}
                    color={c.inkSoft}
                  />
                )}
              </div>

              <Link
                href={`/buildings/${selected.num}`}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2.5 text-[13.5px] hover:opacity-90"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                Open Building {String(selected.num).padStart(2, "0")} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          <div className="rounded-xl border bg-white p-5" style={{ borderColor: c.border }}>
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: c.inkSoft }}>
              Live alerts on map
            </div>
            <ul className="space-y-3">
              {pins.map((p) => {
                const b = buildings.find((bb) => bb.num === p.num);
                const Icon = iconMap[p.iconKey];
                return (
                  <li
                    key={p.num}
                    onClick={() => setSelectedNum(p.num)}
                    className="flex items-center gap-3 cursor-pointer rounded-md -mx-1 px-1 py-1 hover:bg-slate-50"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-md" style={{ background: c.roseSoft, color: c.rose }}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px]" style={{ fontWeight: 600, color: c.ink }}>
                        Bldg {p.num} · {b?.address ?? "—"}
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: c.inkSoft, fontWeight: 500 }}>{p.type}</div>
                    </div>
                    <ArrowRight className="h-4 w-4" style={{ color: c.inkMute }} />
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>

      {isFullscreen && (
        <div
          className="fixed inset-0 z-50 flex flex-col p-4"
          style={{ background: "rgba(15, 23, 42, 0.92)", backdropFilter: "blur(4px)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen site map"
          onClick={(e) => { if (e.target === e.currentTarget) setIsFullscreen(false); }}
        >
          <div
            className="mx-auto w-full max-w-[1600px] flex-1 rounded-2xl border p-4 shadow-2xl flex flex-col overflow-hidden"
            style={{ borderColor: c.border, background: c.mapBg }}
          >
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <div className="text-white/90 text-[14px]" style={{ fontWeight: 600 }}>
                Site Map
                {selected && (
                  <span className="ml-2 text-white/60 text-[12.5px]" style={{ fontWeight: 500 }}>
                    · BLDG {String(selected.num).padStart(2, "0")} — {selected.address}
                  </span>
                )}
              </div>
              <div className="text-white/50 text-[11.5px]" style={{ fontWeight: 500 }}>Press Esc to exit</div>
            </div>
            {renderMapToolbar()}
            <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
              {renderMapBody(
                Math.max(300, winSize.h - 180),
                Math.min(winSize.w - 64, 1568),
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function Row({ k, v, color }: { k: string; v: string; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: c.borderSoft }}>
      <span className="text-[13px]" style={{ color: c.inkSoft, fontWeight: 500 }}>{k}</span>
      <span className="text-[13px] text-right" style={{ color, fontWeight: 600 }}>{v}</span>
    </div>
  );
}
