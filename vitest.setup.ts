import "@testing-library/jest-dom/vitest";

class ResizeObserverMock implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver = ResizeObserverMock;
globalThis.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle);

const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  const rect = getBoundingClientRect.call(this);
  if (this.dataset.ui !== "scroll-viewport") return rect;
  return {
    ...rect,
    bottom: 800,
    height: 800,
    right: 800,
    width: 800,
    toJSON: () => ({}),
  };
};

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    if (this.dataset.ui === "console-row") return 76;
    return 0;
  },
});

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return this.dataset.ui === "scroll-viewport" ? 800 : 0;
  },
});
