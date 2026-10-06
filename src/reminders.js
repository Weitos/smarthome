/**
 * Модуль напоминаний и уведомлений
 * Проверяет истечение сроков годности и оплаты ЖКХ
 * Запускается каждый час через cron
 */

const cron = require('node-cron');
const { getReceiptsDueSoon, getProducts, getUserByTelegramId, getUserNotifications, getUserReminderDays } = require('./storage');

let bot = null;

/**
 * Получение перевода (динамический импорт для избежания циклической зависимости)
 */
function tr(telegramId, key, params = {}) {
  try {
    const { t } = require('./i18n');
    return t(telegramId, key, params);
  } catch (e) {
    // Fallback на русский
    return key;
  }
}

/**
 * Инициализация модуля напоминаний
 * @param {Object} botInstance - Экземпляр бота
 */
function initReminders(botInstance) {
  bot = botInstance;
  
  // Запуск проверки каждый час
  cron.schedule('0 * * * *', () => {
    console.log('[Reminders] Проверка напоминаний...');
    checkAndSendReminders();
  });
  
  console.log('✅ Модуль напоминаний инициализирован');
}

/**
 * Проверка и отправка всех напоминаний
 */
async function checkAndSendReminders() {
  if (!bot) {
    console.error('[Reminders] Бот не инициализирован');
    return;
  }

  try {
    // Проверяем приближающиеся сроки оплаты ЖКХ
    await checkPaymentReminders();
    
    // Проверяем истекающие продукты
    await checkExpiryReminders();
    
  } catch (error) {
    console.error('[Reminders] Ошибка проверки:', error.message);
  }
}

/**
 * Проверка напоминаний об оплате ЖКХ
 */
async function checkPaymentReminders() {
  const receipts = getReceiptsDueSoon(2); // За 2 дня до срока
  
  for (const receipt of receipts) {
    const user = getUserByTelegramId(receipt.user_id);
    if (!user || !getUserNotifications(user.telegram_id)) continue;
    
    const message = tr(user.telegram_id, 'reminders.payment_due', {
      amount: receipt.amount || '?',
      period: receipt.period || '?',
      service: receipt.service_type || 'Услуга'
    });
    
    try {
      await bot.api.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
      console.log(`[Reminders] Отправлено напоминание об оплате пользователю ${user.telegram_id}`);
    } catch (error) {
      console.error(`[Reminders] Ошибка отправки пользователю ${user.telegram_id}:`, error.message);
    }
  }
}

/**
 * Проверка напоминаний о сроке годности продуктов
 */
async function checkExpiryReminders() {
  const users = [
    { telegram_id: 123456789 } // Здесь можно получить всех пользователей
  ];
  
  // Для каждого пользователя проверяем продукты
  for (const user of users) {
    if (!getUserNotifications(user.telegram_id)) continue;
    
    const products = getProducts(user.telegram_id, 100);
    const reminderDays = getUserReminderDays(user.telegram_id);
    
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + reminderDays);
    const warningDate = futureDate.toISOString().split('T')[0];
    
    const expiringProducts = products.filter(p => 
      p.expiry_date && p.expiry_date <= warningDate && p.expiry_date >= new Date().toISOString().split('T')[0]
    );
    
    if (expiringProducts.length > 0) {
      const productList = expiringProducts.slice(0, 5).map(p => p.name).join(', ');
      
      const message = t(user.telegram_id, 'reminders.expiry_warning', {
        product: productList + (expiringProducts.length > 5 ? '...' : '')
      });
      
      try {
        await bot.api.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
        console.log(`[Reminders] Отправлено напоминание о сроке годности пользователю ${user.telegram_id}`);
      } catch (error) {
        // Игнорируем ошибки отправки
      }
    }
  }
}

/**
 * Отправка напоминания конкретному пользователю
 * @param {number} telegramId - ID пользователя
 * @param {string} type - Тип напоминания ('payment' или 'expiry')
 * @param {Object} data - Данные для напоминания
 */
async function sendReminder(telegramId, type, data) {
  if (!bot) return;
  if (!getUserNotifications(telegramId)) return;
  
  let message = '';
  
  if (type === 'payment') {
    message = t(telegramId, 'reminders.payment_due', data);
  } else if (type === 'expiry') {
    message = t(telegramId, 'reminders.expiry_warning', data);
  }
  
  if (message) {
    try {
      await bot.api.sendMessage(telegramId, message, { parse_mode: 'HTML' });
    } catch (error) {
      console.error(`[Reminders] Ошибка отправки:`, error.message);
    }
  }
}

/**
 * Получение списка предстоящих платежей для пользователя
 * @param {number} telegramId - ID пользователя
 * @returns {Array} - Список платежей
 */
function getUpcomingPayments(telegramId, days = 30) {
  const receipts = getReceipts(telegramId, 100);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  const dateStr = futureDate.toISOString().split('T')[0];
  
  return receipts.filter(r => 
    r.payment_due_date && r.payment_due_date <= dateStr
  ).sort((a, b) => a.payment_due_date.localeCompare(b.payment_due_date));
}

module.exports = {
  initReminders,
  checkAndSendReminders,
  sendReminder,
  getUpcomingPayments
};