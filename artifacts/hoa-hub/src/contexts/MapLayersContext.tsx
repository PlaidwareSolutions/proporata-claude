import { createContext, useContext, useState, type ReactNode } from "react";

export type MapLayers = {
  buildings: boolean;
  openWO: boolean;
  insuranceGaps: boolean;
  roofStatus: boolean;
};

type Ctx = {
  layers: MapLayers;
  setLayer: (key: keyof MapLayers, value: boolean) => void;
};

const MapLayersContext = createContext<Ctx | null>(null);

export function MapLayersProvider({ children }: { children: ReactNode }) {
  const [layers, setLayers] = useState<MapLayers>({
    buildings: true,
    openWO: true,
    insuranceGaps: true,
    roofStatus: false,
  });
  const setLayer = (key: keyof MapLayers, value: boolean) =>
    setLayers((prev) => ({ ...prev, [key]: value }));
  return (
    <MapLayersContext.Provider value={{ layers, setLayer }}>
      {children}
    </MapLayersContext.Provider>
  );
}

export function useMapLayers(): Ctx {
  const ctx = useContext(MapLayersContext);
  if (!ctx) throw new Error("useMapLayers must be used within MapLayersProvider");
  return ctx;
}
