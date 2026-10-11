import { blankFrame, fillRect, setPx, type Frame } from "@/core/matrix";

/** Orientation test: red top-left, green top-right, blue bottom-left, white bottom-right, arrow pointing up. */
export function testPattern(): Frame {
  const f = blankFrame();
  fillRect(f, 0, 0, 3, 3, 0xff0000);
  fillRect(f, 13, 0, 3, 3, 0x00ff00);
  fillRect(f, 0, 13, 3, 3, 0x0000ff);
  fillRect(f, 13, 13, 3, 3, 0xffffff);
  for (let y = 4; y < 13; y++) { setPx(f, 7, y, 0xffd000); setPx(f, 8, y, 0xffd000); }
  for (let i = 0; i < 4; i++) { setPx(f, 7 - i, 4 + i, 0xffd000); setPx(f, 8 + i, 4 + i, 0xffd000); }
  return f;
}
