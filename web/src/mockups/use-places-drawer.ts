import { type CSSProperties, useEffect, useRef, useState } from "react";

type Snap = "collapsed" | "half" | "full";
const snaps: Snap[] = ["collapsed", "half", "full"];
export function drawerHeight(snap: Snap, available: number) {
  return snap === "collapsed" ? 52 : Math.round(available * (snap === "half" ? 0.5 : 0.94));
}

export function usePlacesDrawer() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  const [available, setAvailable] = useState(600);
  const [panelWidth, setPanelWidth] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [snap, setSnap] = useState<Snap>("half");
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{y:number;height:number;moved:boolean} | null>(null);
  const skipClick = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    const observer = new ResizeObserver(entries => setAvailable(entries[0].contentRect.height));
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    const panelObserver = new ResizeObserver(entries => {
      const width = entries[0].borderBoxSize[0]?.inlineSize ?? entries[0].contentRect.width;
      if (width > 1) setPanelWidth(width);
    });
    const panel = workspaceRef.current?.querySelector(".d4-drawer");
    if (panel) panelObserver.observe(panel);
    return () => { media.removeEventListener("change", update); observer.disconnect(); panelObserver.disconnect(); };
  }, []);
  const height = drawerHeight(snap, available);
  return {
    workspaceRef, mobile, collapsed, snap,
    bottomInset: mobile ? height : 0,
    leftInset: mobile || collapsed ? 0 : panelWidth,
    style: { "--sheet-height": `${dragHeight ?? height}px` } as CSSProperties,
    open: () => {setCollapsed(false); setSnap(current => current === "collapsed" ? "half" : current);},
    toggle: () => setCollapsed(current => !current),
    handle: {
      onClick: () => {
        if (skipClick.current) {skipClick.current = false; return;}
        setSnap(current => snaps[(snaps.indexOf(current) + 1) % snaps.length]);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        setSnap(current => event.key === "Home" ? "collapsed" : event.key === "End" ? "full" : snaps[Math.max(0, Math.min(2, snaps.indexOf(current) + (event.key === "ArrowUp" ? 1 : -1)))]);
      },
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        skipClick.current = false;
        drag.current = {y:event.clientY,height,moved:false};
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = drag.current;
        if (!start) return;
        const delta = start.y - event.clientY;
        if (Math.abs(delta) > 5) start.moved = true;
        if (start.moved) setDragHeight(Math.max(52, Math.min(available * 0.94, start.height + delta)));
      },
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = drag.current;
        if (!start) return;
        if (start.moved) {
          const next = start.height + start.y - event.clientY;
          setSnap(snaps.reduce((best, candidate) => Math.abs(drawerHeight(candidate, available) - next) < Math.abs(drawerHeight(best, available) - next) ? candidate : best));
          skipClick.current = true;
        }
        drag.current = null;
        setDragHeight(null);
      },
      onPointerCancel: () => {drag.current = null; setDragHeight(null);},
    },
  };
}
