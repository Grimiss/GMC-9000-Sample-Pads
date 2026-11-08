/** Uniform hardware scaling against the visible browser area, including tablet chrome. */
export function installViewportFit() {
  const app = document.querySelector<HTMLElement>("#app")!;
  const viewport = document.querySelector<HTMLElement>(".viewport")!;
  const machine = document.querySelector<HTMLElement>(".machine")!;
  let frame = 0;
  const fit = () => {
    frame = 0;
    const visible = window.visualViewport;
    // Let users deliberately pinch to inspect small controls without fighting their zoom.
    if (visible && visible.scale > 1.01) return;
    const height = visible?.height ?? innerHeight;
    const width = Math.min(
      document.documentElement.clientWidth,
      visible?.width ?? innerWidth,
    );
    document.body.style.height = `${height}px`;
    const style = getComputedStyle(document.body);
    const horizontal =
      parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const vertical =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availableWidth = Math.max(1, width - horizontal - 12);
    app.style.width = `${availableWidth}px`;
    const extras = Array.from(app.children)
      .filter((el) => el !== viewport)
      .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
    const margins = getComputedStyle(viewport);
    const availableHeight = Math.max(
      1,
      height -
        vertical -
        extras -
        parseFloat(margins.marginTop) -
        parseFloat(margins.marginBottom) -
        4,
    );
    const scale = Math.min(availableWidth / 1536, availableHeight / 1024);
    machine.style.transform = `scale(${scale})`;
    viewport.style.width = `${1536 * scale}px`;
    viewport.style.height = `${1024 * scale}px`;
  };
  const requestFit = () => {
    if (!frame) frame = requestAnimationFrame(fit);
  };
  window.addEventListener("resize", requestFit);
  window.visualViewport?.addEventListener("resize", requestFit);
  window.visualViewport?.addEventListener("scroll", requestFit);
  // The MIDI strip is appended later in main's synchronous initialization.
  queueMicrotask(() => {
    const observer = new ResizeObserver(requestFit);
    for (const el of Array.from(app.children))
      if (el !== viewport) observer.observe(el);
    fit();
  });
}
