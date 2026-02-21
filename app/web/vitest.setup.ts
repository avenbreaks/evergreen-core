import "@testing-library/jest-dom/vitest";

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;

  readonly rootMargin = "0px";

  readonly thresholds = [0];

  constructor(...args: unknown[]) {
    void args;
  }

  disconnect() {}

  observe(target: Element) {
    void target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element) {
    void target;
  }
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = MockIntersectionObserver;
}
