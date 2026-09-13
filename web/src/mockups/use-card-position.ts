import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

type Position = { x: number; y: number };
const initialPosition: Position = { x: 16, y: 16 };

export function clampCardPosition(position: Position, area: { width: number; height: number }, card: { width: number; height: number }): Position {
  return {
    x: Math.max(16, Math.min(position.x, area.width - card.width - 16)),
    y: Math.max(16, Math.min(position.y, area.height - card.height - 16)),
  };
}

export function useCardPosition(visible: boolean) {
  const areaRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(initialPosition);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; start: Position; origin: Position } | null>(null);
  const desktop = () => window.matchMedia("(min-width: 641px)").matches;

  const clamp = (next: Position) => {
    const area = areaRef.current;
    const card = cardRef.current;
    return area && card ? clampCardPosition(next,
      { width: area.clientWidth, height: area.clientHeight },
      { width: card.offsetWidth, height: card.offsetHeight }) : next;
  };

  useLayoutEffect(() => {
    if (!visible || !areaRef.current || !cardRef.current) return;
    const keepInMap = () => {
      if (!desktop()) return;
      setPosition(current => {
        const next = clamp(current);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    keepInMap();
    const observer = new ResizeObserver(keepInMap);
    observer.observe(areaRef.current);
    observer.observe(cardRef.current);
    return () => {
      observer.disconnect();
      drag.current = null;
    };
  }, [visible]);

  const stop = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (cancel) setPosition(clamp(drag.current.origin));
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return {
    areaRef,
    cardRef,
    dragging,
    style: { "--card-x": `${position.x}px`, "--card-y": `${position.y}px` } as CSSProperties,
    handle: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (!desktop() || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: position };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        setPosition(clamp({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y }));
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => stop(event),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => stop(event, true),
      onLostPointerCapture: () => { drag.current = null; setDragging(false); },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!desktop()) return;
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          setPosition(clamp(drag.current.origin));
          const pointerId = drag.current.pointerId;
          drag.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
          return;
        }
        const step = event.shiftKey ? 48 : 16;
        const offsets: Record<string, Position> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
        const offset = offsets[event.key];
        if (!offset && event.key !== "Home") return;
        event.preventDefault();
        setPosition(current => clamp(offset ? { x: current.x + offset.x, y: current.y + offset.y } : initialPosition));
      },
    },
  };
}
