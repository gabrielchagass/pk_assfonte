import type { SupportedLanguageCodes } from '../constants/i18n';
import { APP_I18N_OPTIONS } from '../constants/i18n';
import { env } from './env';

/**
 * Maps one `accept-language` entry to a supported language.
 *
 * Upstream compared only the base language (`pt-BR` -> `pt`) with the list,
 * so regional codes such as `pt-BR` never matched and those browsers fell back
 * to English. This tries the full tag first, then the base language against
 * the base of each supported code (`pt`, `pt-PT` -> `pt-BR`).
 */
export const matchSupportedLanguage = (locale: string | undefined): SupportedLanguageCodes | null => {
  const tag = (locale ?? '').split(';')[0].trim().toLowerCase();

  if (!tag) {
    return null;
  }

  const exact = APP_I18N_OPTIONS.supportedLangs.find((lang) => lang.toLowerCase() === tag);

  if (exact) {
    return exact;
  }

  const [language] = tag.split('-');

  return APP_I18N_OPTIONS.supportedLangs.find((lang) => lang.toLowerCase().split('-')[0] === language) ?? null;
};

/**
 * Language used when the browser asks for none of the supported languages.
 *
 * Upstream always uses the source language (English). With
 * `NEXT_PUBLIC_DEFAULT_LANGUAGE` set to a supported code, the instance falls
 * back to it instead.
 */
export const getFallbackLanguage = (): SupportedLanguageCodes => {
  const configured = env('NEXT_PUBLIC_DEFAULT_LANGUAGE');

  return APP_I18N_OPTIONS.supportedLangs.find((lang) => lang === configured) ?? APP_I18N_OPTIONS.sourceLang;
};
