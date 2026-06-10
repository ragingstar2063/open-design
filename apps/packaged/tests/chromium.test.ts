import { describe, expect, it, vi } from "vitest";

import { applyPackagedChromiumSwitches } from "../src/chromium.js";

describe("applyPackagedChromiumSwitches", () => {
  it("disables GPU acceleration before Windows packaged BrowserWindows are created", () => {
    const electronApp = {
      commandLine: {
        appendSwitch: vi.fn(),
      },
      disableHardwareAcceleration: vi.fn(),
    };

    applyPackagedChromiumSwitches(electronApp, "win32");

    expect(electronApp.disableHardwareAcceleration).toHaveBeenCalledTimes(1);
    expect(electronApp.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu");
    expect(electronApp.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu-compositing");
  });

  it("leaves non-Windows packaged startup unchanged", () => {
    const electronApp = {
      commandLine: {
        appendSwitch: vi.fn(),
      },
      disableHardwareAcceleration: vi.fn(),
    };

    applyPackagedChromiumSwitches(electronApp, "darwin");

    expect(electronApp.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(electronApp.commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
