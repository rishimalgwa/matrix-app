import { useEffect, useRef, useState } from "react";
import type { Frame } from "@/core/matrix";

/** Re-renders a preview frame on an interval. `render` receives seconds since mount. */
export function useAnimatedFrame(render: (t: number) => Frame, fps = 30): Frame {
  const fn = useRef(render);
  fn.current = render;
  const [frame, setFrame] = useState(() => render(0));
  useEffect(() => {
    const t0 = performance.now();
    const h = setInterval(() => setFrame(fn.current((performance.now() - t0) / 1000)), 1000 / fps);
    return () => clearInterval(h);
  }, [fps]);
  return frame;
}
