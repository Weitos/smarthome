/**
 * Модуль оплаты через Telegram Stars
 * Интеграция с Telegram Payment API
 */

require('dotenv').config();
const { createPayment, updatePaymentStatus, getPaymentById, updateUserBalance } = require('./storage');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Создание счета для оплаты через Telegram Stars
 * @param {number} telegramId - ID пользователя
 * @param {number} amount - Сумма в рублях
 * @param {number} starsAmount - Количество Stars
 * @returns {Promise<Object>} - Информация о платеже
 */
async function createStarsPayment(telegramId, amount, starsAmount) {
  try {
    const payment = createPayment(telegramId, amount, 'RUB', starsAmount);
    
    // Генерируем ссылку на оплату
    // В реальном приложении нужно использовать Telegram Payment API
    // Здесь создаем "заглушку" которая работает через бота
    
    const paymentLink = `https://t.me/${process.env.BOT_USERNAME || 'SMHomeApp_Bot'}?start=pay_${payment.id}`;
    
    updatePaymentStatus(payment.id, 'pending', paymentLink, '', `stars_${starsAmount}`);
    
    console.log(`✅ Создан платеж Stars: ${starsAmount} Stars = ${amount} ₽`);
    
    return {
      paymentId: payment.id,
      starsAmount,
      amount,
      paymentLink,
      status: 'pending'
    };
  } catch (error) {
    console.error('Ошибка создания платежа Stars:', error.message);
    throw error;
  }
}

/**
 * Обработка успешной оплаты Stars
 * @param {number} paymentId - ID платежа
 * @returns {Promise<Object>} - Результат обработки
 */
async function processSuccessfulPayment(paymentId) {
  const payment = getPaymentById(paymentId);
  
  if (!payment || payment.status !== 'pending') {
    return { processed: false, reason: 'Платеж не найден или уже обработан' };
  }

  updatePaymentStatus(paymentId, 'paid', '', '', payment.stars_payment_id);
  const newBalance = updateUserBalance(payment.user_id, payment.amount);

  console.log(`⭐ Платеж ${paymentId} обработан. Новый баланс: ${newBalance}`);

  return {
    processed: true,
    amount: payment.amount,
    newBalance,
    userId: payment.user_id
  };
}

/**
 * Проверка и обработка webhook от Telegram Stars
 * @param {Object} update - Обновление от Telegram
 * @returns {Promise<Object>} - Результат обработки
 */
async function handleStarsWebhook(update) {
  try {
    // Проверяем успешный платеж
    if (update?.successful_payment) {
      const payment = update.successful_payment;
      
      // Ищем платеж по invoice_id
      const invoiceId = payment.invoice_payload;
      
      // Обрабатываем платеж
      return await processSuccessfulPayment(parseInt(invoiceId));
    }
    
    return { handled: false };
  } catch (error) {
    console.error('Ошибка обработки Stars webhook:', error.message);
    return { handled: false, error: error.message };
  }
}

/**
 * Отправка счета пользователю через Telegram
 * ВНИМАНИЕ: На localhost требуется ручное подтверждение оплаты
 * @param {Object} bot - Экземпляр бота
 * @param {number} telegramId - ID пользователя
 * @param {number} starsAmount - Количество Stars
 * @param {number} rubAmount - Сумма в рублях
 * @returns {Promise<Object>} Информация о созданном платеже
 */
async function sendInvoice(bot, telegramId, starsAmount, rubAmount) {
  try {
    // Создаем запись платежа в базе данных
    const payment = createPayment(telegramId, rubAmount, 'STARS', starsAmount);
    
    // Для реальной оплаты через Telegram Stars нужен зарегистрированный Payment Provider
    // На localhost/local 开发 это не работает без внешнего сервера
    
    // Отправляем пользователю инструкцию
    const message = `⭐ <b>Пополнение через Telegram Stars</b>\n\n` +
      `Количество: <b>${starsAmount} ⭐</b>\n` +
      `Сумма к зачислению: <b>${rubAmount} ₽</b>\n\n` +
      `⚠️ <b>Важно:</b>\n` +
      `На текущем сервере (localhost) оплата Stars требует:\n` +
      `• Публичного домена с HTTPS\n` +
      `• Регистрации Payment Provider в Telegram\n\n` +
      `📋 <b>Альтернатива:</b>\n` +
      `Используйте оплату через Crypto Bot (кнопка "💰 Пополнить")\n\n` +
      `✅ Для тестирования вы можете вручную подтвердить оплату:\n` +
      `/pay_${payment.id} - подтвердить платеж на ${rubAmount} ₽`;
    
    await bot.api.sendMessage(telegramId, message, { parse_mode: 'HTML' });
    
    console.log(`[Stars] Создан тестовый платеж ${payment.id} на ${starsAmount} Stars = ${rubAmount} ₽`);
    
    return {
      paymentId: payment.id,
      starsAmount,
      amount: rubAmount,
      status: 'test_mode'
    };
  } catch (error) {
    console.error('Ошибка создания платежа Stars:', error.message);
    throw error;
  }
}

/**
 * Ручное подтверждение платежа (для тестирования)
 * @param {number} paymentId - ID платежа
 * @returns {Object} Результат
 */
async function confirmTestPayment(paymentId) {
  const payment = getPaymentById(paymentId);
  
  if (!payment || payment.status !== 'pending') {
    return { success: false, message: 'Платеж не найден или уже обработан' };
  }
  
  // Подтверждаем платеж
  updatePaymentStatus(paymentId, 'paid', 'manual_confirm', '', `stars_test_${payment.stars_amount}`);
  const newBalance = updateUserBalance(payment.user_id, payment.amount);
  
  console.log(`[Stars] Тестовый платеж ${paymentId} подтвержден. Новый баланс: ${newBalance}`);
  
  return {
    success: true,
    amount: payment.amount,
    newBalance,
    message: `Баланс пополнен на ${payment.amount} ₽`
  };
}

/**
 * Конвертация RUB в Stars (фиксированный курс: 1 Stars = 2 RUB)
 */
function convertRubToStars(rubAmount) {
  const rate = 2; // 1 Stars = 2 рубля
  return Math.ceil(rubAmount / rate);
}

/**
 * Конвертация Stars в RUB (фиксированный курс: 1 Stars = 2 RUB)
 */
function convertStarsToRub(starsAmount) {
  const rate = 2; // 1 Stars = 2 рубля
  return starsAmount * rate;
}

module.exports = {
  createStarsPayment,
  processSuccessfulPayment,
  handleStarsWebhook,
  sendInvoice,
  convertRubToStars,
  convertStarsToRub
};