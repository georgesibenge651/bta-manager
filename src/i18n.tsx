import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Language = 'fr' | 'en';

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (french: string, english: string) => string;
}

const LANGUAGE_STORAGE_KEY = 'bta-manager-language';
const LanguageContext = createContext<LanguageContextValue | null>(null);

function getStoredLanguage(): Language {
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'fr';
}

export const LanguageProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [language, updateLanguage] = useState<Language>(getStoredLanguage);
  const setLanguage = useCallback((nextLanguage: Language) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    updateLanguage(nextLanguage);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const t = useCallback(
    (french: string, english: string) => (language === 'en' ? english : french),
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider.');
  }
  return context;
}
