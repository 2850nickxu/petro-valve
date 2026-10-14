"use client";

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { STAMP_FORMAT, stamp } from "@/lib/po-agent/session-view";

// Timestamps in the viewer's own time zone. The server only knows UTC, so the first render
// (server + hydration) shows the UTC stamp, then the browser swaps in its local time.

const LOCAL = new Intl.DateTimeFormat("en-US", STAMP_FORMAT);
const LOCAL_FULL = new Intl.DateTimeFormat("en-US", { ...STAMP_FORMAT, year: "numeric", timeZoneName: "short" });

const subscribe = () => () => {};

/** false on the server and during hydration, true once running in the browser. */
function useInBrowser(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/** { short: "Oct 9, 10:32", full: "Oct 9, 2026, 10:32 EDT" } in the viewer's zone. */
function useLocalStamp(iso: string): { short: string; full: string } {
  const inBrowser = useInBrowser();
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { short: iso, full: iso };
  if (!inBrowser) return { short: stamp(iso), full: `${stamp(iso)} UTC` };
  return { short: LOCAL.format(t), full: LOCAL_FULL.format(t) };
}

/** "Oct 9, 10:32" in the viewer's local time; hover shows the year and zone. */
export function LocalTime({ iso, style }: { iso: string; style?: CSSProperties }) {
  const { short, full } = useLocalStamp(iso);
  return (
    <time dateTime={iso} title={full} style={style}>
      {short}
    </time>
  );
}

/** A span or link whose hover title reads "<prefix> <local time>" — for chips that record when data was read. */
export function LocalTimeTitle({
  iso,
  prefix,
  href,
  external,
  style,
  children,
}: {
  iso: string;
  prefix: string;
  href?: string;
  external?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const title = `${prefix} ${useLocalStamp(iso).full}`;
  if (!href) {
    return (
      <span style={style} title={title}>
        {children}
      </span>
    );
  }
  return (
    <a href={href} style={style} title={title} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}
