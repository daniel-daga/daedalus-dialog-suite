/**
 * Tests for applyWindowSecurity - deny-by-default window-open and navigation.
 *
 * @jest-environment node
 */

import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { applyWindowSecurity } from '../src/main/windowSecurity';

interface StubWebContents {
  currentUrl: string;
  windowOpenHandler?: () => { action: string };
  navHandler?: (event: { preventDefault: () => void }, url: string) => void;
  setWindowOpenHandler: (h: () => { action: string }) => void;
  on: (event: string, h: (...args: any[]) => void) => void;
  getURL: () => string;
}

function makeStub(currentUrl: string): StubWebContents {
  const stub: StubWebContents = {
    currentUrl,
    setWindowOpenHandler(h) {
      stub.windowOpenHandler = h;
    },
    on(event, h) {
      if (event === 'will-navigate') stub.navHandler = h as any;
    },
    getURL() {
      return stub.currentUrl;
    },
  };
  return stub;
}

describe('applyWindowSecurity', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('denies all window.open attempts', () => {
    const stub = makeStub('file:///app/index.html');
    applyWindowSecurity(stub as any);
    expect(stub.windowOpenHandler).toBeDefined();
    expect(stub.windowOpenHandler!()).toEqual({ action: 'deny' });
  });

  it('prevents navigation to an external https URL', () => {
    process.env.NODE_ENV = 'production';
    const stub = makeStub('file:///app/index.html');
    applyWindowSecurity(stub as any);
    const event = { preventDefault: jest.fn() };
    stub.navHandler!(event, 'https://evil.example.com');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('allows navigation to the window own current URL (file: reload)', () => {
    process.env.NODE_ENV = 'production';
    const stub = makeStub('file:///app/index.html');
    applyWindowSecurity(stub as any);
    const event = { preventDefault: jest.fn() };
    stub.navHandler!(event, 'file:///app/index.html');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('allows the dev server URL only in development', () => {
    process.env.NODE_ENV = 'development';
    const stub = makeStub('http://localhost:5173');
    applyWindowSecurity(stub as any);
    const allowedEvent = { preventDefault: jest.fn() };
    stub.navHandler!(allowedEvent, 'http://localhost:5173/index.html');
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();

    const blockedEvent = { preventDefault: jest.fn() };
    stub.navHandler!(blockedEvent, 'https://evil.example.com');
    expect(blockedEvent.preventDefault).toHaveBeenCalled();
  });
});
