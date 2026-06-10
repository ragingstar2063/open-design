export interface PackagedChromiumApp {
  commandLine: {
    appendSwitch(name: string, value?: string): void;
  };
  disableHardwareAcceleration(): void;
}

export function applyPackagedChromiumSwitches(
  electronApp: PackagedChromiumApp,
  platform = process.platform,
): void {
  if (platform !== "win32") return;

  electronApp.disableHardwareAcceleration();
  electronApp.commandLine.appendSwitch("disable-gpu");
  electronApp.commandLine.appendSwitch("disable-gpu-compositing");
}
