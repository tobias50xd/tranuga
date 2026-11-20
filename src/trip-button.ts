const LAP_MS = 2_100;

export function animateTripButton(button: HTMLButtonElement) {
  const bus = button.querySelector<SVGSVGElement>('.trip-bus-icon')!;
  const label = button.querySelector<HTMLElement>('.calculation-label')!;
  const text = label.firstChild as Text;
  const range = document.createRange();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let animations: Animation[] = [];

  function update() {
    const elapsed = Number(animations[0]?.currentTime ?? 0);
    animations.forEach(animation => animation.cancel());
    animations = [];
    button.toggleAttribute('data-driving', !reducedMotion.matches);
    if (reducedMotion.matches) return;

    const width = button.clientWidth;
    const start = button.getBoundingClientRect().left + button.clientLeft;
    const busWidth = bus.getBoundingClientRect().width;
    const artwork = bus.getBBox();
    const scale = busWidth / bus.viewBox.baseVal.width;
    const frontPadding = busWidth - (artwork.x + artwork.width) * scale;
    const rearPadding = artwork.x * scale;
    const distance = width + busWidth;
    const bounds = label.getBoundingClientRect();
    const hide: Keyframe[] = [{ clipPath: 'inset(0)', offset: 0, easing: 'step-end' }];
    const reveal: Keyframe[] = [];

    // The front reaches each character on the first lap. The rear clears it on the next lap.
    for (let index = 0; index < text.length; index++) {
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const letter = range.getBoundingClientRect();
      const atEnd = index === text.length - 1;
      hide.push({
        clipPath: `inset(0 0 0 ${atEnd ? '100%' : `${letter.right - bounds.left}px`})`,
        offset: (letter.left - start + frontPadding) / (2 * distance),
        easing: 'step-end',
      });
      reveal.push({
        clipPath: `inset(0 ${atEnd ? 0 : bounds.right - letter.right}px 0 0)`,
        offset: .5 + (letter.right - start + busWidth - rearPadding) / (2 * distance),
        easing: 'step-end',
      });
    }

    animations = [
      bus.animate([
        { transform: `translate(${-busWidth}px, -50%)` },
        { transform: `translate(${width}px, -50%)` },
      ], { duration: LAP_MS, iterations: Infinity }),
      label.animate([...hide, ...reveal, { clipPath: 'inset(0)', offset: 1 }],
        { duration: LAP_MS * 2, iterations: Infinity }),
    ];
    const startTime = Number(document.timeline.currentTime) - elapsed;
    animations.forEach(animation => { animation.startTime = startTime; });
  }

  const observer = new ResizeObserver(update);
  observer.observe(button);
  observer.observe(label);
  reducedMotion.addEventListener('change', update);
  return () => {
    observer.disconnect();
    reducedMotion.removeEventListener('change', update);
    animations.forEach(animation => animation.cancel());
    button.removeAttribute('data-driving');
  };
}
