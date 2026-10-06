/**
 * Модуль хранилища данных (работа с SQLite)
 * С защитой от SQL-инъекций через parameterized queries
 */

const db = require('./db/secure');

/**
 * Получение текущей недели (ISO неделя)
 */
function getCurrentWeek() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const pastYearDays = Math.floor((now - yearStart) / (24 * 60 * 60 * 1000));
  const weekNum = Math.ceil((pastYearDays + yearStart.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

/**
 * Сброс счетчиков сканирований на новую неделю
 */
function checkAndResetWeeklyLimits(telegramId) {
  const currentWeek = getCurrentWeek();
  const user = getUserByTelegramId(telegramId);
  
  if (user.last_scan_week !== currentWeek) {
    db.update(
      `UPDATE users SET weekly_products_scans = 0, weekly_receipts_scans = 0, last_scan_week = ? WHERE telegram_id = ?`,
      [currentWeek, telegramId]
    );
  }
}

/**
 * Получение пользователя по Telegram ID
 */
function getUserByTelegramId(telegramId) {
  return db.selectOne('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
}

/**
 * Получение или создание пользователя
 */
function getOrCreateUser(telegramId, username = '', firstName = '', lastName = '') {
  let user = getUserByTelegramId(telegramId);
  
  if (!user) {
    const currentWeek = getCurrentWeek();
    db.insert(
      `INSERT INTO users (telegram_id, username, first_name, last_name, balance, language, currency, is_premium, weekly_products_scans, weekly_receipts_scans, last_scan_week)
       VALUES (?, ?, ?, ?, 0, 'en', 'USD', 0, 0, 0, ?)`,
      [telegramId, username, firstName || '', lastName || '', currentWeek]
    );
    user = getUserByTelegramId(telegramId);
  } else {
    checkAndResetWeeklyLimits(telegramId);
  }
  
  return user;
}

/**
 * Обновление баланса пользователя
 */
function updateUserBalance(telegramId, amount) {
  db.update(
    `UPDATE users SET balance = balance + ?, updated_at = datetime('now') WHERE telegram_id = ?`,
    [amount, telegramId]
  );
  return getUserByTelegramId(telegramId).balance;
}

/**
 * Установка Premium статуса
 */
function setUserPremium(telegramId, isPremium, expiresAt = null) {
  if (expiresAt) {
    db.update(
      `UPDATE users SET is_premium = ?, premium_expires_at = ?, updated_at = datetime('now') WHERE telegram_id = ?`,
      [isPremium ? 1 : 0, expiresAt, telegramId]
    );
  } else {
    db.update(
      `UPDATE users SET is_premium = ?, updated_at = datetime('now') WHERE telegram_id = ?`,
      [isPremium ? 1 : 0, telegramId]
    );
  }
}

/**
 * Проверка истечения Premium
 */
function checkPremiumExpiry(telegramId) {
  const user = getUserByTelegramId(telegramId);
  if (user?.is_premium && user.premium_expires_at) {
    const expiryDate = new Date(user.premium_expires_at);
    if (expiryDate < new Date()) {
      setUserPremium(telegramId, false);
      return true; // Премиум истек
    }
  }
  return false;
}

/**
 * Проверка лимитов сканирования
 */
function checkScanLimit(telegramId, type) {
  checkAndResetWeeklyLimits(telegramId);
  const user = getUserByTelegramId(telegramId);
  
  // Premium пользователи без лимитов
  if (user.is_premium) {
    checkPremiumExpiry(telegramId); // Проверяем актуальность
    return { allowed: true, remaining: Infinity, isPremium: true };
  }
  
  const maxFreeScans = 3; // 3 бесплатных сканирования в неделю
  
  if (type === 'product') {
    const used = user.weekly_products_scans || 0;
    return { 
      allowed: used < maxFreeScans, 
      remaining: Math.max(0, maxFreeScans - used),
      isPremium: false 
    };
  } else if (type === 'receipt') {
    const used = user.weekly_receipts_scans || 0;
    return { 
      allowed: used < maxFreeScans, 
      remaining: Math.max(0, maxFreeScans - used),
      isPremium: false 
    };
  }
  
  return { allowed: false, remaining: 0, isPremium: false };
}

/**
 * Использование сканирования
 */
function useScan(telegramId, type) {
  const limit = checkScanLimit(telegramId, type);
  if (!limit.allowed) return false;
  
  if (type === 'product') {
    db.update(
      `UPDATE users SET weekly_products_scans = weekly_products_scans + 1 WHERE telegram_id = ?`,
      [telegramId]
    );
  } else if (type === 'receipt') {
    db.update(
      `UPDATE users SET weekly_receipts_scans = weekly_receipts_scans + 1 WHERE telegram_id = ?`,
      [telegramId]
    );
  }
  
  return true;
}

/**
 * Получение всех пользователей
 */
function getAllUsers() {
  return db.select('SELECT * FROM users ORDER BY created_at DESC');
}

/**
 * Добавление продукта
 */
function addProduct(telegramId, productData) {
  const products = productData.parsed?.products || [];
  const results = [];
  
  if (products.length > 0) {
    for (const p of products) {
      const info = db.insert(
        `INSERT INTO products (user_id, name, category, quantity, expiry_date, raw_response, image_file_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          telegramId,
          p.name,
          p.category || '',
          p.quantity || '',
          p.expiry_date || null,
          productData.rawResponse || '',
          productData.imageFileId || ''
        ]
      );
      results.push({ id: info.lastInsertRowid, ...p });
    }
  } else {
    db.insert(
      `INSERT INTO products (user_id, name, category, quantity, raw_response, image_file_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [telegramId, 'Unknown', '', '', productData.rawResponse || '', productData.imageFileId || '']
    );
  }
  
  return results;
}

/**
 * Получение продуктов пользователя
 */
function getProducts(telegramId, limit = 50) {
  return db.select(
    'SELECT * FROM products WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [telegramId, limit]
  );
}

/**
 * Удаление продукта
 */
function deleteProduct(productId, telegramId) {
  return db.remove('DELETE FROM products WHERE id = ? AND user_id = ?', [productId, telegramId]);
}

/**
 * Добавление чека
 */
function addReceipt(telegramId, receiptData) {
  const meterReadings = receiptData.parsed?.meterReadings 
    ? JSON.stringify(receiptData.parsed.meterReadings) 
    : '';
  
  // Вычисляем дату оплаты (обычно 20 числа следующего месяца)
  let paymentDueDate = null;
  if (receiptData.parsed?.period) {
    const match = receiptData.parsed.period.match(/(\w+)\s+(\d{4})/);
    if (match) {
      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                          'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const enMonths = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
      const monthIdx = monthNames.indexOf(match[1]);
      if (monthIdx !== -1) {
        const nextMonth = monthIdx === 11 ? 0 : monthIdx + 1;
        const year = monthIdx === 11 ? parseInt(match[2]) + 1 : parseInt(match[2]);
        paymentDueDate = `${year}-${(nextMonth + 1).toString().padStart(2, '0')}-20`;
      }
    }
  }
  
  const info = db.insert(
    `INSERT INTO receipts (user_id, amount, period, payment_due_date, address, service_type, meter_readings, raw_response, image_file_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      telegramId,
      receiptData.parsed?.amount || null,
      receiptData.parsed?.period || '',
      paymentDueDate,
      receiptData.parsed?.address || '',
      receiptData.parsed?.serviceType || '',
      meterReadings,
      receiptData.rawResponse || '',
      receiptData.imageFileId || ''
    ]
  );
  
  return { id: info.lastInsertRowid, ...receiptData.parsed };
}

/**
 * Получение чеков пользователя
 */
function getReceipts(telegramId, limit = 20) {
  return db.select(
    'SELECT * FROM receipts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [telegramId, limit]
  );
}

/**
 * Получение чека по ID
 */
function getReceiptById(receiptId, telegramId) {
  return db.selectOne('SELECT * FROM receipts WHERE id = ? AND user_id = ?', [receiptId, telegramId]);
}

/**
 * Получение чеков с истекающим сроком оплаты
 */
function getReceiptsDueSoon(days = 2) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  const dateStr = futureDate.toISOString().split('T')[0];
  
  return db.select(
    `SELECT r.*, u.telegram_id FROM receipts r 
     JOIN users u ON r.user_id = u.telegram_id 
     WHERE r.payment_due_date <= ? AND r.payment_due_date IS NOT NULL
     ORDER BY r.payment_due_date ASC`,
    [dateStr]
  );
}

/**
 * Добавление устройства
 */
function addDevice(telegramId, deviceData) {
  const info = db.insert(
    `INSERT INTO devices (user_id, name, type, room, status, mqtt_topic, custom_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      telegramId,
      deviceData.name,
      deviceData.type,
      deviceData.room || '',
      'offline',
      deviceData.mqttTopic || '',
      JSON.stringify(deviceData.customData || {})
    ]
  );
  
  return getDeviceById(info.lastInsertRowid, telegramId);
}

/**
 * Получение устройств пользователя
 */
function getDevices(telegramId) {
  return db.select('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC', [telegramId]);
}

/**
 * Получение устройства по ID
 */
function getDeviceById(deviceId, telegramId) {
  return db.selectOne('SELECT * FROM devices WHERE id = ? AND user_id = ?', [deviceId, telegramId]);
}

/**
 * Обновление статуса устройства
 */
function updateDeviceStatus(deviceId, telegramId, status) {
  return db.update(
    `UPDATE devices SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [status, deviceId, telegramId]
  );
}

/**
 * Удаление устройства
 */
function deleteDevice(deviceId, telegramId) {
  return db.remove('DELETE FROM devices WHERE id = ? AND user_id = ?', [deviceId, telegramId]);
}

/**
 * Добавление лога устройства
 */
function addDeviceLog(deviceId, action, status = 'success', details = '') {
  return db.insert(
    `INSERT INTO device_logs (device_id, action, status, details) VALUES (?, ?, ?, ?)`,
    [deviceId, action, status, details]
  );
}

/**
 * Получение логов устройства
 */
function getDeviceLogs(deviceId, limit = 20) {
  return db.select(
    'SELECT * FROM device_logs WHERE device_id = ? ORDER BY created_at DESC LIMIT ?',
    [deviceId, limit]
  );
}

/**
 * Создание платежа
 */
function createPayment(telegramId, amount, currency = 'RUB', starsAmount = null) {
  const info = db.insert(
    `INSERT INTO payments (user_id, amount, currency, status, stars_amount) VALUES (?, ?, ?, 'pending', ?)`,
    [telegramId, amount, currency, starsAmount]
  );
  return getPaymentById(info.lastInsertRowid);
}

/**
 * Получение платежа по ID
 */
function getPaymentById(paymentId) {
  return db.selectOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
}

/**
 * Обновление статуса платежа
 */
function updatePaymentStatus(paymentId, status, paymentUrl = '', cryptoInvoiceId = '', starsPaymentId = '') {
  return db.update(
    `UPDATE payments SET status = ?, payment_url = ?, crypto_invoice_id = ?, stars_payment_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, paymentUrl, cryptoInvoiceId, starsPaymentId, paymentId]
  );
}

/**
 * Получение ожидающих платежей
 */
function getPendingPayments(telegramId) {
  return db.select("SELECT * FROM payments WHERE user_id = ? AND status = 'pending'", [telegramId]);
}

/**
 * Получение настройки
 */
function getSetting(key, defaultValue = '') {
  const result = db.selectOne('SELECT value FROM settings WHERE key = ?', [key]);
  return result ? result.value : defaultValue;
}

/**
 * Установка настройки
 */
function setSetting(key, value) {
  db.insert(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
    [key, value]
  );
}

/**
 * Получение статистики пользователя
 */
function getStats(telegramId) {
  const user = getUserByTelegramId(telegramId);
  const products = getProducts(telegramId, 1000);
  const receipts = getReceipts(telegramId, 1000);
  const devices = getDevices(telegramId);
  
  checkAndResetWeeklyLimits(telegramId);
  
  const totalSpent = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
  const today = new Date().toISOString().split('T')[0];
  const expiringProducts = products.filter(p => p.expiry_date && p.expiry_date <= today);
  
  return {
    user,
    totalProducts: products.length,
    totalReceipts: receipts.length,
    totalSpent,
    totalDevices: devices.length,
    weeklyProductsLeft: 3 - (user.weekly_products_scans || 0),
    weeklyReceiptsLeft: 3 - (user.weekly_receipts_scans || 0),
    expiringProducts: expiringProducts.length
  };
}

/**
 * Получение языка пользователя из БД
 */
function getUserLanguage(telegramId) {
  const user = getUserByTelegramId(telegramId);
  return user?.language || 'ru';
}

/**
 * Установка языка пользователя
 */
function setUserLanguage(telegramId, language) {
  db.update(
    `UPDATE users SET language = ?, updated_at = datetime('now') WHERE telegram_id = ?`,
    [language, telegramId]
  );
}

/**
 * Получение статуса уведомлений пользователя
 */
function getUserNotifications(telegramId) {
  const user = getUserByTelegramId(telegramId);
  return user?.notifications === 1;
}

/**
 * Установка уведомлений пользователя
 */
function setUserNotifications(telegramId, enabled) {
  db.update(
    `UPDATE users SET notifications = ?, updated_at = datetime('now') WHERE telegram_id = ?`,
    [enabled ? 1 : 0, telegramId]
  );
}

/**
 * Получение дней напоминаний пользователя
 */
function getUserReminderDays(telegramId) {
  const user = getUserByTelegramId(telegramId);
  return user?.reminder_days || 2;
}

/**
 * Установка дней напоминаний пользователя
 */
function setUserReminderDays(telegramId, days) {
  db.update(
    `UPDATE users SET reminder_days = ?, updated_at = datetime('now') WHERE telegram_id = ?`,
    [days, telegramId]
  );
}

// === Валюты (курсы на 09.05.2026) ===

const CURRENCY_RATES = {
  RUB: 1,
  USD: 82,
  EUR: 90,
  CNY: 11.5,
  TRY: 2.5,
  BYN: 28,
  KZT: 0.18
};

const CURRENCY_SYMBOLS = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  CNY: '¥',
  TRY: '₺',
  BYN: 'Br',
  KZT: '₸'
};

/**
 * Получение валюты пользователя
 */
function getUserCurrency(telegramId) {
  const user = getUserByTelegramId(telegramId);
  return user?.currency || 'RUB';
}

/**
 * Установка валюты пользователя
 */
function setUserCurrency(telegramId, currency) {
  if (!CURRENCY_RATES[currency]) {
    currency = 'RUB';
  }
  db.update(
    `UPDATE users SET currency = ?, updated_at = datetime('now') WHERE telegram_id = ?`,
    [currency, telegramId]
  );
}

/**
 * Конвертация суммы в рубли
 */
function toRubles(amount, fromCurrency) {
  const rate = CURRENCY_RATES[fromCurrency] || 1;
  return amount * rate;
}

/**
 * Конвертация суммы из рублей в другую валюту
 */
function fromRubles(amount, toCurrency) {
  const rate = CURRENCY_RATES[toCurrency] || 1;
  return amount / rate;
}

/**
 * Форматирование суммы с валютой
 */
function formatBalance(amount, currency = 'RUB') {
  const symbol = CURRENCY_SYMBOLS[currency] || '₽';
  const converted = fromRubles(amount, currency);
  return `${converted.toFixed(2)} ${symbol}`;
}

/**
 * Получение всех доступных валют
 */
function getAvailableCurrencies() {
  return Object.keys(CURRENCY_RATES);
}

/**
 * Получение всех пользователей с истекающей подпиской
 */
function getExpiringPremiumUsers() {
  const now = new Date().toISOString();
  return db.select(
    `SELECT * FROM users WHERE is_premium = 1 AND premium_expires_at IS NOT NULL AND premium_expires_at <= datetime('now', '+3 days')`,
    []
  );
}

/**
 * Получение всех пользователей
 */
function getAllUsersWithSettings() {
  return db.select('SELECT * FROM users ORDER BY created_at DESC', []);
}

module.exports = {
  getUserByTelegramId,
  getOrCreateUser,
  updateUserBalance,
  setUserPremium,
  checkPremiumExpiry,
  checkScanLimit,
  useScan,
  getAllUsers,
  getAllUsersWithSettings,
  addProduct,
  getProducts,
  deleteProduct,
  addReceipt,
  getReceipts,
  getReceiptById,
  getReceiptsDueSoon,
  addDevice,
  getDevices,
  getDeviceById,
  updateDeviceStatus,
  deleteDevice,
  addDeviceLog,
  getDeviceLogs,
  createPayment,
  getPaymentById,
  updatePaymentStatus,
  getPendingPayments,
  getSetting,
  setSetting,
  getStats,
  getCurrentWeek,
  // Новые функции настроек
  getUserLanguage,
  setUserLanguage,
  getUserNotifications,
  setUserNotifications,
  getUserReminderDays,
  setUserReminderDays,
  getExpiringPremiumUsers,
  // Валюты
  getUserCurrency,
  setUserCurrency,
  formatBalance,
  getAvailableCurrencies,
  CURRENCY_RATES,
  CURRENCY_SYMBOLS,
  // === Бизнес-логика ===
  
  /**
   * Стоимость сканирования (рублей)
   */
  SCAN_PRICES: {
    product: 5,    // 5 рублей за продукт
    receipt: 10    // 10 рублей за чек ЖКХ
  },
  
  PREMIUM_COST: 500,      // 500 рублей/месяц
  PREMIUM_MIN_BALANCE: 500, // Минимальный баланс для активации
  
  /**
   * Списание средств за сканирование
   * @returns {boolean} Успешно ли списание
   */
  chargeForScan(telegramId, type) {
    const user = getUserByTelegramId(telegramId);
    if (!user) return false;
    
    // Premium не платит за сканирования
    if (user.is_premium) return true;
    
    // Если есть бесплатные лимиты - используем их
    const limit = checkScanLimit(telegramId, type);
    if (limit.allowed && !limit.isPremium) {
      return true; // Бесплатное сканирование
    }
    
    // Списываем деньги
    const price = type === 'product' ? this.SCAN_PRICES.product : this.SCAN_PRICES.receipt;
    
    if (user.balance < price) {
      return false; // Недостаточно средств
    }
    
    updateUserBalance(telegramId, -price);
    console.log(`💳 Списано ${price} рублей за ${type}`);
    return true;
  },
  
  /**
   * Активация Premium
   * @returns {Object} Результат: { success: boolean, message: string }
   */
  activatePremium(telegramId) {
    const user = getUserByTelegramId(telegramId);
    const currency = user?.currency || 'RUB';
    const { formatBalance } = this;
    
    if (!user) {
      return { success: false, message: 'Пользователь не найден' };
    }
    
    if (user.is_premium) {
      return { success: false, message: 'Premium уже активен' };
    }
    
    const costRubles = this.PREMIUM_COST;
    const costFormatted = formatBalance(costRubles, currency);
    const balanceFormatted = formatBalance(user.balance, currency);
    
    if (user.balance < this.PREMIUM_MIN_BALANCE) {
      return { 
        success: false, 
        message: `Недостаточно средств. Нужно минимум ${costFormatted}. Ваш баланс: ${balanceFormatted}` 
      };
    }
    
    // Списываем 500 рублей и активируем Premium
    const newBalance = updateUserBalance(telegramId, -costRubles);
    const newBalanceFormatted = formatBalance(newBalance, currency);
    
    // Устанавливаем срок действия - через 30 дней
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    setUserPremium(telegramId, true, expiresAt.toISOString());
    
    console.log(`⭐ Premium активирован для ${telegramId}. Списано ${costFormatted}. Баланс: ${newBalanceFormatted}`);
    
    return { 
      success: true, 
      message: `✅ Premium активирован на 30 дней!\n💰 Списано: ${costFormatted}\n💳 Новый баланс: ${newBalanceFormatted}` 
    };
  },
  
  /**
   * Продление Premium (автоматическое списание)
   * @returns {Object} Результат продления
   */
  renewPremium(telegramId) {
    const user = getUserByTelegramId(telegramId);
    
    if (!user || !user.is_premium) {
      return { success: false, reason: 'Нет Premium' };
    }
    
    // Если баланс меньше 500 - деактивируем Premium
    if (user.balance < this.PREMIUM_COST) {
      setUserPremium(telegramId, false);
      console.log(`⚠️ Premium деактивирован (недостаточно средств): ${telegramId}`);
      return { success: false, reason: 'Недостаточно средств для продления' };
    }
    
    // Списываем 500 рублей и продлеваем
    const newBalance = updateUserBalance(telegramId, -this.PREMIUM_COST);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    setUserPremium(telegramId, true, expiresAt.toISOString());
    
    console.log(`⭐ Premium продлен для ${telegramId}. Списано ${this.PREMIUM_COST} руб.`);
    
    return { success: true, newBalance };
  },
  
  /**
   * Проверить и продлить все Premium подписки
   */
  checkAllPremiumRenewals() {
    const users = getAllUsersWithSettings();
    let renewed = 0;
    let deactivated = 0;
    
    for (const user of users) {
      if (!user.is_premium || !user.premium_expires_at) continue;
      
      const expiresAt = new Date(user.premium_expires_at);
      const now = new Date();
      
      // Если срок истек - продлеваем
      if (expiresAt <= now) {
        const result = this.renewPremium(user.telegram_id);
        if (result.success) {
          renewed++;
        } else {
          deactivated++;
        }
      }
    }
    
    console.log(`[Premium] Продлено: ${renewed}, Деактивировано: ${deactivated}`);
    return { renewed, deactivated };
  }
};