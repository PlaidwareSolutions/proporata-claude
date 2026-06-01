export const c = {
  canvas: "#F6F7FB",
  panel: "#FFFFFF",
  sidebar: "#0B1020",
  sidebarText: "#D6DAEA",
  sidebarMute: "#8E96B4",
  ink: "#0B1020",
  inkSoft: "#2A3050",
  inkMute: "#5A6285",
  border: "#E0E4F0",
  borderSoft: "#EFF1F8",
  cobalt: "#3245FF",
  cobaltSoft: "#E5E8FF",
  emerald: "#0E8A6B",
  emeraldSoft: "#DCF3EC",
  amber: "#A66C0E",
  amberSoft: "#FBEFD6",
  rose: "#B8264C",
  roseSoft: "#FBE3E9",
  mapBg: "#0F1530",
  mapGrid: "#1B2342",
  mapGreen: "#1F2A4D",
} as const;

export type Status = "good" | "watch" | "urgent";

export const statusColor: Record<Status, string> = {
  good: c.emerald,
  watch: c.amber,
  urgent: c.rose,
};

export const statusSoft: Record<Status, string> = {
  good: c.emeraldSoft,
  watch: c.amberSoft,
  urgent: c.roseSoft,
};

export const statusLabel: Record<Status, string> = {
  good: "Healthy",
  watch: "Watch",
  urgent: "Urgent",
};
