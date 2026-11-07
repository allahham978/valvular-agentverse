import Link from "next/link";
import { DataLabel } from "@/components/data-label";

export function SiteHeader() {
  return (
    <header className="flex items-center gap-3 px-6 pt-5">
      <Link href="/?stage=workspace" className="text-lg font-semibold tracking-tight">
        Valvular
      </Link>
      <DataLabel>Synthetic test hearts</DataLabel>
    </header>
  );
}
