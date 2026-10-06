require('dotenv').config();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { createPayment, updatePaymentStatus, getPaymentById, updateUserBalance } = require('./storage');

const CRYPTO_BOT_API_URL = 'https://pay.crypt.bot/api';
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN;

console.log('[CryptoBot] Токен загружен:', CRYPTO_BOT_TOKEN ? '✓ (длина: ' + CRYPTO_BOT_TOKEN.length + ')' : '✗');

let cryptoBotClient = null;

function getCryptoBotClient() {
  if (!CRYPTO_BOT_TOKEN) {
    console.log('⚠️ CRYPTO_BOT_TOKEN не настроен. Платежи недоступны.');
    return null;
  }

  if (!cryptoBotClient) {
    cryptoBotClient = axios.create({
      baseURL: CRYPTO_BOT_API_URL,
      headers: {
        'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
        'Content-Type': 'application/json'
      }
    });
  }

  return cryptoBotClient;
}

/**
 * Получение списка доступных криптовалют для оплаты
 */
async function getAvailableAssets() {
  const client = getCryptoBotClient();
  if (!client) return [];
  
  try {
    const response = await client.get('/getAssets');
    return response.data?.result || [];
  } catch (error) {
    console.error('Ошибка получения активов:', error.message);
    return [];
  }
}

/**
 * Создание счета с автоматическим выбором доступной криптовалюты
 */
async function createInvoice(telegramId, amount, currency = 'USDT') {
  const client = getCryptoBotClient();
  
  if (!client) {
    throw new Error('Crypto Bot API не настроен. Добавьте CRYPTO_BOT_TOKEN в .env');
  }

  try {
    // Пробуем получить доступные активы
    const assets = await getAvailableAssets();
    console.log('[CryptoBot] Доступные активы:', assets.length);
    
    // Список популярных криптовалют для оплаты
    const cryptoCurrencies = ['USDT', 'BTC', 'ETH', 'TON', 'USDC'];
    
    // Находим первую доступную криптовалюту
    let selectedCrypto = null;
    
    if (assets.length > 0) {
      // Ищем среди доступных активов
      for (const crypto of cryptoCurrencies) {
        const asset = assets.find(a => a.code === crypto);
        if (asset) {
          selectedCrypto = crypto;
          break;
        }
      }
    } else {
      // Если не удалось получить активы - пробуем по очереди
      selectedCrypto = 'USDT';
    }
    
    // Конвертируем рубли в выбранную криптовалюту
    const rates = { USDT: 90, BTC: 5000000, ETH: 250000, TON: 6, USDC: 90 };
    const rate = rates[selectedCrypto] || 90;
    const cryptoAmount = (amount / rate).toFixed(selectedCrypto === 'BTC' ? 6 : 2);
    
    const payment = createPayment(telegramId, amount, selectedCrypto);
    
    const invoiceData = {
      amount: cryptoAmount,
      asset: selectedCrypto,
      description: `Пополнение баланса бота (ID: ${telegramId}) - ${amount} ₽`,
      expires_in: 3600,
      custom_data: JSON.stringify({ payment_id: payment.id, telegram_id: telegramId, rub_amount: amount })
    };

    console.log('[CryptoBot] Создание счета:', invoiceData);
    
    const response = await client.post('/createInvoice', invoiceData);
    
    if (!response.data?.result) {
      throw new Error('Неверный ответ от API: ' + JSON.stringify(response.data));
    }
    
    const invoice = response.data.result;
    
    updatePaymentStatus(
      payment.id,
      'pending',
      invoice.pay_url,
      invoice.invoice_id
    );

    console.log(`✅ Создан счет Crypto Bot: ${invoice.invoice_id} на ${cryptoAmount} ${selectedCrypto} (${amount} ₽)`);

    return {
      paymentId: payment.id,
      invoiceId: invoice.invoice_id,
      payUrl: invoice.pay_url,
      amount: invoice.amount,
      currency: invoice.asset,
      rubAmount: amount,
      status: invoice.status
    };
  } catch (error) {
    console.error('Ошибка создания счета Crypto Bot:', error.response?.data || error.message);
    
    // Более подробные сообщения об ошибках
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      throw new Error('⚠️ Временная проблема с подключением к Crypto Bot. Попробуйте позже или используйте /pay_test');
    }
    if (error.response?.status === 400 && error.response?.data?.error?.code === 'ASSET_REQUIRED') {
      throw new Error('⚠️ Crypto Bot API требует настройку криптовалюты. Используйте /pay_test для тестового пополнения.\n\nДля настройки:\n1. Откройте @CryptoBot\n2. Нажмите "Создать магазин"\n3. Добавьте криптовалюту (USDT)');
    }
    if (error.response?.status === 401) {
      throw new Error('❌ Ошибка авторизации. Проверьте токен Crypto Bot.');
    }
    if (error.response?.status === 400) {
      throw new Error('❌ Ошибка: ' + (error.response?.data?.error?.description || 'Неверные данные'));
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('❌ Нет подключения к Crypto Bot API. Проверьте интернет.');
    }
    throw new Error('Ошибка: ' + error.message);
  }
}

async function checkInvoice(invoiceId) {
  const client = getCryptoBotClient();
  
  if (!client) {
    return { status: 'unknown', error: 'API не настроен' };
  }

  try {
    const response = await client.get('/getInvoice', { params: { invoice_id: invoiceId } });
    return response.data.result;
  } catch (error) {
    console.error('Ошибка проверки счета:', error.response?.data || error.message);
    return { status: 'unknown', error: error.message };
  }
}

async function getBalance() {
  const client = getCryptoBotClient();
  
  if (!client) {
    return null;
  }

  try {
    const response = await client.get('/getBalance');
    return response.data.result;
  } catch (error) {
    console.error('Ошибка получения баланса:', error.response?.data || error.message);
    return null;
  }
}

async function checkAndProcessPayment(paymentId) {
  const payment = getPaymentById(paymentId);
  
  if (!payment || payment.status !== 'pending') {
    return { processed: false, reason: 'Платеж не найден или уже обработан' };
  }

  const invoiceStatus = await checkInvoice(payment.crypto_invoice_id);
  
  if (invoiceStatus.status === 'paid' || invoiceStatus.status === 'completed') {
    updatePaymentStatus(paymentId, 'paid');
    const newBalance = updateUserBalance(payment.user_id, payment.amount);
    
    console.log(`💰 Платеж ${paymentId} обработан. Новый баланс: ${newBalance}`);
    
    return {
      processed: true,
      amount: payment.amount,
      newBalance
    };
  }

  return { processed: false, status: invoiceStatus.status };
}

async function processWebHook(update) {
  try {
    if (update.update_type !== 'invoice_paid') {
      return { handled: false, reason: 'Не invoice_paid' };
    }

    const invoice = update.payload;
    const customData = JSON.parse(invoice.custom_data || '{}');
    
    const paymentId = customData.payment_id;
    if (!paymentId) {
      return { handled: false, reason: 'Нет custom_data' };
    }

    const payment = getPaymentById(paymentId);
    if (!payment || payment.status === 'paid') {
      return { handled: true };
    }

    updatePaymentStatus(paymentId, 'paid');
    const newBalance = updateUserBalance(payment.user_id, payment.amount);

    console.log(`💰 WebHook: Платеж ${paymentId} на ${payment.amount} обработан. Баланс: ${newBalance}`);

    return {
      handled: true,
      paymentId,
      amount: payment.amount,
      newBalance,
      userId: payment.user_id
    };
  } catch (error) {
    console.error('Ошибка обработки WebHook:', error.message);
    return { handled: false, error: error.message };
  }
}

async function getPayments(telegramId, limit = 10) {
  const { getPendingPayments } = require('./storage');
  return getPendingPayments(telegramId);
}

module.exports = {
  createInvoice,
  checkInvoice,
  getBalance,
  checkAndProcessPayment,
  processWebHook,
  getPayments
};