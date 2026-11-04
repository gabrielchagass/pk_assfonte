import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractLocaleData } from './i18n';
import { getFallbackLanguage, matchSupportedLanguage } from './locale-match';

const headers = (acceptLanguage: string) => new Headers({ 'accept-language': acceptLanguage });

describe('locale match', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('matches regional codes that are supported as such', () => {
    expect(matchSupportedLanguage('pt-BR')).toBe('pt-BR');
    expect(matchSupportedLanguage(' pt-br;q=0.9')).toBe('pt-BR');
    expect(matchSupportedLanguage('pt')).toBe('pt-BR');
    expect(matchSupportedLanguage('pt-PT')).toBe('pt-BR');
  });

  it('keeps base-language matches and rejects unknown languages', () => {
    expect(matchSupportedLanguage('en-US')).toBe('en');
    expect(matchSupportedLanguage('de')).toBe('de');
    expect(matchSupportedLanguage('ru-RU')).toBeNull();
    expect(matchSupportedLanguage('')).toBeNull();
    expect(matchSupportedLanguage(undefined)).toBeNull();
  });

  it('picks the first supported language of a Brazilian browser', () => {
    expect(extractLocaleData({ headers: headers('pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7') }).lang).toBe('pt-BR');
  });

  it('falls back to English unless a default language is configured', () => {
    expect(getFallbackLanguage()).toBe('en');
    expect(extractLocaleData({ headers: headers('ru-RU') }).lang).toBe('en');

    vi.stubEnv('NEXT_PUBLIC_DEFAULT_LANGUAGE', 'pt-BR');
    expect(getFallbackLanguage()).toBe('pt-BR');
    expect(extractLocaleData({ headers: headers('ru-RU') }).lang).toBe('pt-BR');
    expect(extractLocaleData({ headers: headers('') }).lang).toBe('pt-BR');

    vi.stubEnv('NEXT_PUBLIC_DEFAULT_LANGUAGE', 'xx');
    expect(getFallbackLanguage()).toBe('en');
  });
});
