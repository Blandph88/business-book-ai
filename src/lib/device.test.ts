import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isMobileDevice, applyDeviceClass } from "./device";

// device.ts reads navigator.userAgent, navigator.platform, navigator.maxTouchPoints and
// window.matchMedia. We override those per test, then restore.

function setNavigator(props: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}) {
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(navigator, k, { configurable: true, value: v });
  }
}

function setMatchMedia(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: coarse && q.includes("coarse") }),
  });
}

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

beforeEach(() => {
  // Reset to a plain desktop baseline.
  setNavigator({ userAgent: DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 0 });
  setMatchMedia(false);
  document.documentElement.classList.remove("is-mobile");
});

afterEach(() => {
  document.documentElement.classList.remove("is-mobile");
});

describe("isMobileDevice — desktop", () => {
  it("a desktop Mac with no touch points and fine pointer is NOT mobile", () => {
    expect(isMobileDevice()).toBe(false);
  });

  it("a narrow desktop window (coarse query false, no touch) is still NOT mobile", () => {
    setMatchMedia(false);
    expect(isMobileDevice()).toBe(false);
  });
});

describe("isMobileDevice — UA-based mobile", () => {
  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android) AppleWebKit Silk/Kindle",
  ])("treats UA %s as mobile", (ua) => {
    setNavigator({ userAgent: ua, platform: "", maxTouchPoints: 0 });
    expect(isMobileDevice()).toBe(true);
  });
});

describe("isMobileDevice — iPadOS-as-Mac", () => {
  it("MacIntel platform WITH multiple touch points is treated as mobile (iPadOS 13+)", () => {
    setNavigator({ userAgent: DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 5 });
    setMatchMedia(false);
    expect(isMobileDevice()).toBe(true);
  });

  it("MacIntel with a single (or zero) touch point is NOT mobile (a real Mac with a trackpad)", () => {
    setNavigator({ userAgent: DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 1 });
    setMatchMedia(false);
    expect(isMobileDevice()).toBe(false);
  });
});

describe("isMobileDevice — coarse-pointer touch", () => {
  it("touch points + a coarse pointer (non-Mac) is mobile", () => {
    setNavigator({ userAgent: DESKTOP_UA, platform: "Win32", maxTouchPoints: 3 });
    setMatchMedia(true);
    expect(isMobileDevice()).toBe(true);
  });

  it("touch points but a FINE pointer (touchscreen laptop) is NOT mobile", () => {
    setNavigator({ userAgent: DESKTOP_UA, platform: "Win32", maxTouchPoints: 3 });
    setMatchMedia(false);
    expect(isMobileDevice()).toBe(false);
  });
});

describe("applyDeviceClass", () => {
  it("adds is-mobile to <html> on a mobile device", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148",
      platform: "",
      maxTouchPoints: 0,
    });
    applyDeviceClass();
    expect(document.documentElement.classList.contains("is-mobile")).toBe(true);
  });

  it("does not add is-mobile on a desktop device", () => {
    applyDeviceClass();
    expect(document.documentElement.classList.contains("is-mobile")).toBe(false);
  });
});
