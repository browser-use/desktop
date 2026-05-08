import arcLogo from '../assets/browser-logos/arc.svg';
import bliskLogo from '../assets/browser-logos/blisk.svg';
import braveLogo from '../assets/browser-logos/brave.svg';
import chromiumLogo from '../assets/browser-logos/chromium.svg';
import cometLogo from '../assets/browser-logos/comet.svg';
import diaLogo from '../assets/browser-logos/dia.svg';
import ghostBrowserLogo from '../assets/browser-logos/ghost-browser.svg';
import googleChromeLogo from '../assets/browser-logos/google-chrome.svg';
import heliumLogo from '../assets/browser-logos/helium.svg';
import iridiumLogo from '../assets/browser-logos/iridium.svg';
import microsoftEdgeLogo from '../assets/browser-logos/microsoft-edge.svg';
import operaLogo from '../assets/browser-logos/opera.svg';
import sidekickLogo from '../assets/browser-logos/sidekick.svg';
import sigmaosLogo from '../assets/browser-logos/sigmaos.svg';
import thoriumLogo from '../assets/browser-logos/thorium.svg';
import ungoogledChromiumLogo from '../assets/browser-logos/ungoogled-chromium.svg';
import vivaldiLogo from '../assets/browser-logos/vivaldi.svg';
import waveboxLogo from '../assets/browser-logos/wavebox.svg';
import yandexLogo from '../assets/browser-logos/yandex.svg';

export const browserLogoByKey: Record<string, string> = {
  arc: arcLogo,
  blisk: bliskLogo,
  brave: braveLogo,
  chromium: chromiumLogo,
  comet: cometLogo,
  dia: diaLogo,
  'ghost-browser': ghostBrowserLogo,
  'google-chrome': googleChromeLogo,
  'google-chrome-canary': googleChromeLogo,
  helium: heliumLogo,
  iridium: iridiumLogo,
  'microsoft-edge': microsoftEdgeLogo,
  opera: operaLogo,
  sidekick: sidekickLogo,
  sigmaos: sigmaosLogo,
  thorium: thoriumLogo,
  'ungoogled-chromium': ungoogledChromiumLogo,
  vivaldi: vivaldiLogo,
  wavebox: waveboxLogo,
  yandex: yandexLogo,
};

export function browserLogoForKey(browserKey?: string): string | null {
  if (!browserKey) return null;
  return browserLogoByKey[browserKey] ?? null;
}
