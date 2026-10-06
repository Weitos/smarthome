/**
 * Модуль интернационализации (i18n)
 * Поддержка русского и английского языков
 * Данные хранятся в SQLite в таблице users
 */

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '..', 'i18n');

let translations = {
  ru: {},
  en: {}
};

/**
 * Загрузка переводов из JSON файлов
 */
function loadTranslations() {
  try {
    const ruPath = path.join(I18N_DIR, 'ru.json');
    const enPath = path.join(I18N_DIR, 'en.json');

    if (fs.existsSync(ruPath)) {
      translations.ru = JSON.parse(fs.readFileSync(ruPath, 'utf-8'));
    }
    if (fs.existsSync(enPath)) {
      translations.en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
    }

    console.log('✅ Загружены переводы: ru, en');
  } catch (error) {
    console.error('Ошибка загрузки переводов:', error.message);
  }
}

/**
 * Получение перевода по ключу
 * @param {number} telegramId - ID пользователя
 * @param {string} key - Ключ перевода (например 'menu.main')
 * @param {Object} params - Параметры для подстановки
 * @returns {string} Переведенный текст
 */
function t(telegramId, key, params = {}) {
  // Импортируем storage здесь для избежания циклической зависимости
  let lang = 'ru';
  
  try {
    const { getUserLanguage } = require('./storage');
    lang = getUserLanguage(telegramId) || 'ru';
  } catch (e) {
    // Если storage не доступен, используем русский
  }
  
  const trans = translations[lang] || translations.ru;

  const keys = key.split('.');
  let value = trans;

  for (const k of keys) {
    value = value?.[k];
    if (!value) break;
  }

  if (typeof value !== 'string') {
    value = translations.ru[key] || key;
  }

  if (typeof value === 'string') {
    for (const [param, val] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), val);
    }
  }

  return value || key;
}

/**
 * Форматирование даты для пользователя
 * @param {string} dateStr - Строка даты
 * @param {number} telegramId - ID пользователя
 * @returns {string} Отформатированная дата
 */
function formatDate(dateStr, telegramId) {
  if (!dateStr) return ' - ';
  
  let lang = 'ru';
  try {
    const { getUserLanguage } = require('./storage');
    lang = getUserLanguage(telegramId) || 'ru';
  } catch (e) {}
  
  const date = new Date(dateStr);
  
  const options = { 
    day: 'numeric', 
    month: 'short', 
    hour: '2-digit', 
    minute: '2-digit' 
  };
  
  return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', options);
}

// Загружаем переводы при инициализации
loadTranslations();

module.exports = {
  t,
  formatDate,
  reload: loadTranslations
};