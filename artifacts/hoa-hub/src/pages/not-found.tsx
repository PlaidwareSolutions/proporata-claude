import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";

export default function NotFound() {
  return (
    <Layout title="Not Found">
      <div className="rounded-xl border bg-white p-12 text-center" style={{ borderColor: c.border }}>
        <div className="font-mono-num text-[64px]" style={{ color: c.cobalt, fontWeight: 700, letterSpacing: "-0.04em" }}>
          404
        </div>
        <p className="mt-2 text-[14px]" style={{ color: c.inkSoft, fontWeight: 500 }}>
          That page is not on the plat.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-md px-4 py-2 text-[13.5px]"
          style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
        >
          Back to Site Map
        </Link>
      </div>
    </Layout>
  );
}
