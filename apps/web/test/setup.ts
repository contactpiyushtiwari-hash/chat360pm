import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vite define is not applied in jsdom tests.
(globalThis as { __RELEASE__?: string }).__RELEASE__ = 'test';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
