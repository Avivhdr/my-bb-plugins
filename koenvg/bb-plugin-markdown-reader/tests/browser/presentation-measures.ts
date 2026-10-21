// Controlled fixture measurements, not installed BB theme certification.
export function geometry(e: HTMLElement) {
  const rect = e.getBoundingClientRect(),
    prose = e.querySelector<HTMLElement>(".mr-prose")!;
  const layout = e.querySelector<HTMLElement>(".mr-document-layout")!,
    lr = layout.getBoundingClientRect();
  const toolbar = e.querySelector<HTMLElement>(".mr-toolbar")!,
    tr = toolbar.getBoundingClientRect();
  const ps = getComputedStyle(prose),
    h2 = getComputedStyle(prose.querySelector("h2")!);
  const image = prose.querySelector("img")!,
    ir = image.getBoundingClientRect();
  return {
    width: e.clientWidth,
    scrollWidth: e.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    proseWidth: prose.clientWidth,
    proseFont: ps.fontSize,
    lineHeight: ps.lineHeight,
    layoutWidth: lr.width,
    leftSpace: lr.left - rect.left,
    rightSpace: rect.right - lr.right,
    padding: getComputedStyle(e.querySelector(".mr-content")!).padding,
    sectionAbove: h2.marginTop,
    sectionBelow: h2.marginBottom,
    outline: layout.dataset.outline,
    titleLines: prose.querySelector("h1")!.getBoundingClientRect().height,
    pathTruncated:
      toolbar.querySelector(".mr-filename")!.scrollWidth >
      toolbar.querySelector(".mr-filename")!.clientWidth,
    buttons: Array.from(toolbar.querySelectorAll("button")).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        name: b.textContent,
        width: r.width,
        height: r.height,
        inside:
          r.left >= tr.left && r.right <= tr.right && r.top >= tr.top && r.bottom <= tr.bottom,
      };
    }),
    code: Array.from(prose.querySelectorAll("pre")).map((c) => ({
      width: c.clientWidth,
      scrollWidth: c.scrollWidth,
    })),
    tables: Array.from(prose.querySelectorAll(".mr-table-scroll")).map((c) => ({
      width: c.clientWidth,
      scrollWidth: c.scrollWidth,
    })),
    image: {
      width: ir.width,
      height: ir.height,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    },
  };
}

export function contrast() {
  const root = document.querySelector(".markdown-reader")!,
    prose = root.querySelector(".mr-prose")!;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const pixel = (color: string, base: string | null = null) => {
    ctx.clearRect(0, 0, 1, 1);
    if (base) {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 1, 1);
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  };
  const rgb = (rgba: number[]) => `rgb(${rgba.slice(0, 3).join(",")})`;
  const luminance = (rgba: number[]) =>
    rgba
      .slice(0, 3)
      .map((value) => {
        const v = value / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const ratio = (a: number[], b: number[]) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const bg = getComputedStyle(root).backgroundColor,
    fg = getComputedStyle(prose).color;
  const bodyBg = pixel(bg),
    bodyFg = pixel(fg, bg);
  const tokens = Array.from(root.querySelectorAll("pre .token")).map((t) => {
    const surface = getComputedStyle(t.closest("pre")!).backgroundColor;
    const background = pixel(surface, rgb(bodyBg)),
      foreground = pixel(getComputedStyle(t).color, rgb(background));
    return { class: t.className, foreground, background, ratio: ratio(foreground, background) };
  });
  return {
    body: {
      cssForeground: fg,
      cssBackground: bg,
      foreground: bodyFg,
      background: bodyBg,
      ratio: ratio(bodyFg, bodyBg),
    },
    tokenMin: Math.min(...tokens.map((t) => t.ratio)),
    tokens,
    radius: getComputedStyle(root.querySelector(".mr-view-controls")!).borderRadius,
  };
}
