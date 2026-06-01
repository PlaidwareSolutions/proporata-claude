import { Link } from "wouter";
import { c } from "@/lib/theme";
import { useGetSettings } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";

const APP_VERSION = __APP_VERSION__;

export function AppFooter() {
  const { data: orgSettings } = useGetSettings();
  const { user } = useAuth();
  const orgName = orgSettings?.name ?? "Quail Valley HOA";
  const docsHref = user?.role === "resident" ? "/portal/documents" : "/documents";
  const year = new Date().getFullYear();

  return (
    <footer
      className="mt-10 border-t px-7 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]"
      style={{ borderColor: c.border, color: c.inkMute, background: "rgba(255,255,255,0.6)" }}
      data-testid="app-footer"
    >
      <div className="flex items-center gap-2">
        <img src="/favicon-color.png" alt="" className="h-4 w-4 object-contain" />
        <span style={{ fontWeight: 600, color: c.inkSoft }}>{orgName}</span>
        <span>·</span>
        <span className="font-mono-num">v{APP_VERSION}</span>
      </div>
      <div className="flex items-center gap-4 ml-auto">
        <Link href={docsHref} className="hover:underline" style={{ color: c.inkMute }}>
          Documents
        </Link>
        <Link href="/help" className="hover:underline" style={{ color: c.inkMute }}>
          Help &amp; Glossary
        </Link>
        <a href="#privacy" className="hover:underline" style={{ color: c.inkMute }}>
          Privacy
        </a>
        <a href="#terms" className="hover:underline" style={{ color: c.inkMute }}>
          Terms
        </a>
        <span>© {year}</span>
      </div>
    </footer>
  );
}
