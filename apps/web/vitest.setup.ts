// Registers @testing-library/jest-dom's DOM-oriented matchers (toBeInTheDocument, etc.)
// on Vitest's `expect`. Loaded globally per vitest.config.ts's `setupFiles`; the import
// itself is a no-op outside jsdom (extends `expect`, does not touch `window`/`document`),
// so it is safe to share with the rest of the workspace's node-environment suites.
import '@testing-library/jest-dom/vitest';

// jsdom lacks a few browser APIs that Radix primitives (select, dialog) use when they open.
if (typeof window !== 'undefined') {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
}
