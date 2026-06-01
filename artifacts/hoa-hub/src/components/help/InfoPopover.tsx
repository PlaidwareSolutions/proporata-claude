import { Info } from "lucide-react";
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGetGlossaryTerm } from "@workspace/api-client-react";
import { c } from "@/lib/theme";

interface InfoPopoverProps {
  termKey: string;
  size?: "xs" | "sm";
  label?: string;
}

export function InfoPopover({ termKey, size = "xs", label }: InfoPopoverProps) {
  const iconSize = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  const btnSize = size === "xs" ? "h-4 w-4" : "h-5 w-5";
  const { data: term } = useGetGlossaryTerm(termKey);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? `Help: ${label}` : `What is ${termKey}?`}
          className={`inline-flex items-center justify-center rounded-full ${btnSize} hover:bg-slate-100 transition-colors`}
          style={{ color: c.inkMute }}
          data-testid={`info-popover-${termKey}`}
        >
          <Info className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[300px] p-3.5"
        side="top"
        align="start"
        style={{ borderColor: c.border }}
      >
        {!term ? (
          <p className="text-[12.5px]" style={{ color: c.inkMute }}>Loading…</p>
        ) : (
          <div>
            <p className="text-[13px]" style={{ fontWeight: 700, color: c.ink }}>{term.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: c.inkSoft }}>
              {term.shortDef}
            </p>
            <div className="mt-2.5 flex items-center justify-between text-[11.5px]">
              <Link
                href={`/help/glossary/${term.termKey}`}
                className="hover:underline"
                style={{ color: c.cobalt, fontWeight: 600 }}
              >
                Read more →
              </Link>
              {term.seeAlsoRoute ? (
                <Link href={term.seeAlsoRoute} className="hover:underline" style={{ color: c.inkMute }}>
                  Go to page
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
