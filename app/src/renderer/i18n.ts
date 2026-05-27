import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

const LANG_KEY = 'browser-use-language';

export function getStoredLanguage(): string {
  try {
    return localStorage.getItem(LANG_KEY) || 'en';
  } catch {
    return 'en';
  }
}

export function setStoredLanguage(lang: string): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch { /* ignore */ }
}

const savedLang = typeof window !== 'undefined'
  ? getStoredLanguage()
  : 'en';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
    prefix: '$',
    suffix: '',
  },
  returnObjects: false,
  keySeparator: false,
  nsSeparator: false,
});

export default i18n;
