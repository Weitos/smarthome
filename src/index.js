/**
 * Точка входа Telegram-бота
 * Инициализация всех модулей и запуск бота
 */

require('dotenv').config();
const { bot } = require('./bot');
const { processWebHook } = require('./cryptobot');
const { handleStarsWebhook } = require('./stars');

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

console.log('🤖 Запуск Telegram-бота для умного дома...');
console.log('📦 База данных: SQLite (защищенная)');
console.log('💡 Умный дом: MQTT + Home Assistant');

const cryptoBotToken = process.env.CRYPTO_BOT_TOKEN;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (cryptoBotToken) {
  console.log('💳 Платежи: Crypto Bot API ✓');
} else {
  console.log('💳 Платежи: Crypto Bot API ✗');
}

if (openRouterKey) {
  console.log('🧠 AI: OpenRouter (google/gemma-4-31b-it:free) ✓');
} else {
  console.log('🧠 AI: OpenRouter ✗');
}

console.log('🌐 Многоязычность: RU, EN ✓');

// Webhook для Telegram (если настроен)
if (WEBHOOK_URL && !WEBHOOK_URL.includes('your-domain')) {
  bot.api.setWebhook(WEBHOOK_URL).then(() => {
    console.log(`✅ Webhook установлен: ${WEBHOOK_URL}`);
  }).catch((err) => {
    console.error('Ошибка webhook:', err.message);
  });
}

// Запуск бота
bot.start({
  onStart: (botInfo) => {
    console.log(`\n✅ Бот запущен успешно!`);
    console.log(`   Username: @${botInfo.username}`);
    console.log(`   ID: ${botInfo.id}`);
    console.log(`\n📋 Команды:`);
    console.log(`   /start - Главное меню`);
    console.log(`   /help - Справка`);
    console.log(`   /profile - Профиль`);
    console.log(`   /devices - Устройства (Premium)`);
    console.log(`   /stats - Статистика`);
    console.log(`   /premium - Информация о Premium`);
    console.log(`   /tariffs - Тарифы и цены`);
    console.log(`   /pay_test - Тестовое пополнение`);
  }
});

// Запускаем проверку Premium каждый день в полночь
const cron = require('node-cron');
cron.schedule('0 0 * * *', () => {
  console.log('[Cron] Проверка Premium подписок...');
  try {
    const { checkAllPremiumRenewals } = require('./storage');
    const result = checkAllPremiumRenewals();
    if (result.renewed > 0 || result.deactivated > 0) {
      console.log(`[Cron] Premium: продлено ${result.renewed}, деактивировано ${result.deactivated}`);
    }
  } catch (error) {
    console.error('[Cron] Ошибка проверки Premium:', error.message);
  }
});
console.log('✅ Cron: проверка Premium запущена (каждый день в 00:00)');

// Web-сервер для Crypto Bot и Telegram Stars webhook
if (cryptoBotToken || true) { // Всегда запускаем для webhook
  const express = require('express');
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      bot: 'running',
      features: {
        crypto: !!cryptoBotToken,
        openrouter: !!openRouterKey,
        mqtt: true,
        stars: true
      }
    });
  });

  // Crypto Bot Webhook
  app.post('/webhook/cryptobot', async (req, res) => {
    try {
      const result = await processWebHook(req.body);
      
      if (result.handled && result.userId) {
        const { getUserByTelegramId } = require('./storage');
        const user = getUserByTelegramId(result.userId);
        
        if (user) {
          try {
            await bot.api.sendMessage(
              user.telegram_id,
              `💰 <b>Платеж получен!</b>\n\n` +
              `Сумма: ${result.amount} ₽\n` +
              `Новый баланс: ${result.newBalance} ₽\n\n` +
              `Спасибо за пополнение!`,
              { parse_mode: 'HTML' }
            );
          } catch (e) {
            console.error('Ошибка уведомления:', e.message);
          }
        }
      }
      
      res.json({ ok: true });
    } catch (error) {
      console.error('Webhook error:', error.message);
      res.json({ ok: false, error: error.message });
    }
  });

  // Telegram Stars Webhook
  app.post('/webhook/stars', async (req, res) => {
    try {
      const result = await handleStarsWebhook(req.body);
      
      if (result.processed && result.userId) {
        const { getUserByTelegramId } = require('./storage');
        const user = getUserByTelegramId(result.userId);
        
        if (user) {
          await bot.api.sendMessage(
            user.telegram_id,
            `⭐ <b>Оплата через Stars получена!</b>\n\n` +
            `Сумма: ${result.amount} ₽\n` +
            `Новый баланс: ${result.newBalance} ₽`,
            { parse_mode: 'HTML' }
          );
        }
      }
      
      res.json({ ok: true });
    } catch (error) {
      console.error('Stars webhook error:', error.message);
      res.json({ ok: false });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`\n🌐 Web-сервер: http://localhost:${PORT}`);
    console.log(`   📡 Crypto Bot: http://localhost:${PORT}/webhook/cryptobot`);
    console.log(`   ⭐ Stars: http://localhost:${PORT}/webhook/stars`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Порт ${PORT} занят! Измените PORT в .env`);
    } else {
      console.error('Ошибка сервера:', err.message);
    }
  });
}

console.log('\n🎯 Бот готов к работе!\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📌 Лимиты: 3 сканирования в неделю бесплатно');
console.log('⭐ Premium: безлимит + умный дом');
console.log('🌐 Язык: меняется в настройках');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');