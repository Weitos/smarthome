/**
 * Основной модуль Telegram-бота
 * Интеграция: grammY, SQLite, OpenRouter, MQTT, Crypto Bot, Telegram Stars
 * 
 * Функции:
 * - Распознавание продуктов по фото
 * - Сканирование квитанций ЖКХ
 * - Управление умным домом (MQTT + Home Assistant)
 * - Оплата через Crypto Bot и Telegram Stars
 * - Лимиты сканирований (3 бесплатно в неделю)
 * - Premium статус для полного доступа
 * - Напоминания об оплате и сроке годности
 * - Многоязычность (RU/EN)
 */

require('dotenv').config();
const { Bot, Keyboard, InlineKeyboard, session } = require('grammy');
const { 
  getOrCreateUser, addDevice, getDevices, getDeviceById, 
  deleteDevice, getStats, checkScanLimit, useScan, 
  setUserPremium, getUserByTelegramId,
  getUserLanguage, setUserLanguage, getUserNotifications, setUserNotifications,
  chargeForScan, activatePremium, SCAN_PRICES, PREMIUM_COST,
  formatBalance, getUserCurrency, setUserCurrency
} = require('./storage');
const { connectMQTT, turnOnLight, turnOffLight, disconnectMQTT } = require('./smarthome');
const { createInvoice } = require('./cryptobot');
const { createStarsPayment, convertRubToStars, convertStarsToRub } = require('./stars');
const { initReminders } = require('./reminders');
const { t, formatDate } = require('./i18n');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Ошибка: TELEGRAM_BOT_TOKEN не задан в .env');
  process.exit(1);
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

/**
 * Создание главной клавиатуры
 */
function createMainKeyboard(telegramId) {
  return new Keyboard()
    .text(t(telegramId, 'buttons.kitchen'))
    .text(t(telegramId, 'buttons.receipts'))
    .row()
    .text(t(telegramId, 'buttons.smart_home'))
    .text(t(telegramId, 'buttons.stats'))
    .row()
    .text(t(telegramId, 'buttons.profile'))
    .text(t(telegramId, 'buttons.settings'))
    .resized();
}

/**
 * Создание клавиатуры умного дома
 */
function createSmartHomeKeyboard(telegramId) {
  return new Keyboard()
    .text(t(telegramId, 'buttons.all_devices'))
    .text(t(telegramId, 'buttons.add_device'))
    .row()
    .text(t(telegramId, 'buttons.back'))
    .resized();
}

/**
 * Создание клавиатуры профиля
 */
function createProfileKeyboard(telegramId) {
  return new Keyboard()
    .text(t(telegramId, 'buttons.top_up_crypto'))
    .text(t(telegramId, 'buttons.top_up_stars'))
    .row()
    .text(t(telegramId, 'buttons.payment_history'))
    .text(t(telegramId, 'buttons.premium'))
    .row()
    .text(t(telegramId, 'buttons.currency'))
    .text(t(telegramId, 'buttons.back'))
    .resized();
}

/**
 * Создание клавиатуры выбора суммы
 */
function createPaymentAmountKeyboard(telegramId) {
  return new Keyboard()
    .text('💵 50').text('💵 100').text('💵 500').row()
    .text('💵 1000').text('💵 5000').text(t(telegramId, 'payment.custom_amount')).row()
    .text(t(telegramId, 'buttons.back'))
    .resized();
}

/**
 * Создание клавиатуры выбора Stars
 */
function createStarsKeyboard(telegramId) {
  return new Keyboard()
    .text('⭐ 99').text('⭐ 250').text('⭐ 500').row()
    .text('⭐ 1000').text('⭐ 2500').text(t(telegramId, 'payment.custom_amount')).row()
    .text(t(telegramId, 'buttons.back'))
    .resized();
}

/**
 * Inline клавиатура для устройства
 */
function createDeviceInlineKeyboard(device) {
  const statusEmoji = device.status === 'online' ? '🟢' : '🔴';
  
  return new InlineKeyboard()
    .text(`${statusEmoji} ${device.name}`, `device_toggle_${device.id}`)
    .text('📊 История', `device_logs_${device.id}`)
    .row()
    .text('🗑️ Удалить', `device_delete_${device.id}`);
}

/**
 * Клавиатура настроек
 */
function createSettingsKeyboard(telegramId) {
  const notifStatus = getUserNotifications(telegramId) ? '🔔' : '🔕';
  const lang = getUserLanguage(telegramId);
  const langFlag = lang === 'ru' ? '🇷🇺' : '🇬🇧';
  
  return new Keyboard()
    .text(`${langFlag} ${t(telegramId, 'buttons.language')}`)
    .text(`${notifStatus} ${t(telegramId, 'buttons.notifications')}`)
    .row()
    .text(t(telegramId, 'buttons.back'))
    .resized();
}

/**
 * Отправка главного меню
 */
async function sendMainMenu(ctx) {
  ctx.session.state = 'idle';
  const telegramId = ctx.from.id;
  
  await ctx.reply(
    t(telegramId, 'menu.main'),
    { parse_mode: 'HTML', reply_markup: createMainKeyboard(telegramId) }
  );
}

// === СЕССИЯ ===

bot.use(session({
  initial: () => ({
    state: 'idle',
    waitingForAmount: false,
    waitingForDeviceName: false,
    waitingForDeviceType: false,
    waitingForDeviceRoom: false,
    waitingForDeviceTopic: false
  })
}));

// === МИДЛВАР ===

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId) {
    const user = getOrCreateUser(userId, ctx.from?.username, ctx.from?.first_name, ctx.from?.last_name);
    ctx.user = user;
  }
  await next();
});

// === КОМАНДЫ ===

bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;
  getOrCreateUser(telegramId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  
  await ctx.reply(
    t(telegramId, 'start.welcome', { name: ctx.from.first_name || 'друг' }),
    { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
  );
});

bot.command('help', async (ctx) => {
  const telegramId = ctx.from.id;
  await ctx.reply(
    t(telegramId, 'start.help'),
    { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
  );
});

bot.command('profile', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = getUserByTelegramId(telegramId);
  
  const stats = checkScanLimit(telegramId, 'product');
  
  await ctx.reply(
    `👤 <b>${t(telegramId, 'menu.profile').replace('<b>', '').replace('</b>', '')}</b>\n\n` +
    `Telegram ID: <code>${user.telegram_id}</code>\n` +
    `Имя: @${user.username || 'не указано'}\n` +
    `Баланс: <b>${user.balance} ₽</b>\n` +
    `Статус: ${user.is_premium ? '⭐ Premium' : '👤 Обычный'}\n\n` +
    `📊 ${t(telegramId, 'limits.scans_left', { 
      products: user.is_premium ? '∞' : (3 - user.weekly_products_scans),
      receipts: user.is_premium ? '∞' : (3 - user.weekly_receipts_scans)
    })}\n\n` +
    `${t(telegramId, 'buttons.top_up')}:`,
    { parse_mode: "HTML", reply_markup: createProfileKeyboard(telegramId) }
  );
});

bot.command('devices', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = getUserByTelegramId(telegramId);
  
  if (!user.is_premium) {
    await ctx.reply(
      t(telegramId, 'smart_home.premium_required'),
      { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
    );
    return;
  }
  
  ctx.session.state = 'smart_home';
  const devices = getDevices(telegramId);
  
  if (devices.length === 0) {
    await ctx.reply(
      `💡 <b>${t(telegramId, 'menu.smart_home').replace('<b>', '').replace('</b>', '')}</b>\n\n` +
      t(telegramId, 'smart_home.no_devices'),
      { parse_mode: "HTML", reply_markup: createSmartHomeKeyboard(telegramId) }
    );
    return;
  }

  let text = `💡 <b>Устройства:</b>\n\n`;
  for (const device of devices) {
    const statusEmoji = device.status === 'online' ? '🟢' : '🔴';
    text += `${statusEmoji} <b>${device.name}</b> (${device.type})\n`;
    text += `   Комната: ${device.room || 'не указана'}\n\n`;
  }

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: createSmartHomeKeyboard(telegramId) });
});

bot.command('stats', async (ctx) => {
  const telegramId = ctx.from.id;
  const stats = getStats(telegramId);
  const lang = getUserLanguage(telegramId);
  const currency = getUserCurrency(telegramId);
  const { formatBalance } = require('./storage');
  const balanceText = formatBalance(stats.user.balance, currency);
  const spentText = formatBalance(stats.totalSpent, currency);
  
  const isRu = lang === 'ru';
  
  const report = `📊 <b>${isRu ? 'Статистика' : 'Statistics'}</b>\n\n` +
    `👤 <b>${isRu ? 'Пользователь' : 'User'}:</b>\n` +
    `├ ${isRu ? 'Баланс' : 'Balance'}: ${balanceText}\n` +
    `└ Premium: ${stats.user.is_premium ? '✅' : '❌'}\n\n` +
    `🍎 <b>${isRu ? 'Продукты' : 'Products'}:</b> ${stats.totalProducts}\n` +
    `🧾 <b>${isRu ? 'Чеки' : 'Receipts'}:</b> ${stats.totalReceipts}\n` +
    `💰 <b>${isRu ? 'Потрачено' : 'Spent'}:</b> ${spentText}\n` +
    `💡 <b>${isRu ? 'Устройства' : 'Devices'}:</b> ${stats.totalDevices}\n\n` +
    `📊 <b>${isRu ? 'Лимиты недели' : 'Weekly limits'}:</b>\n` +
    `├ ${isRu ? 'Продукты' : 'Products'}: ${stats.user.is_premium ? '∞' : stats.weeklyProductsLeft}\n` +
    `└ ${isRu ? 'Чеки' : 'Receipts'}: ${stats.user.is_premium ? '∞' : stats.weeklyReceiptsLeft}`;
  
  await ctx.reply(report, { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
});

// Команда для ручного подтверждения платежа (для тестирования)
bot.command('pay', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const telegramId = ctx.from.id;
  
  if (args.length < 2) {
    await ctx.reply(
      '💳 <b>Подтверждение платежа</b>\n\n' +
      'Использование: /pay <ID платежа>\n\n' +
      'После оплаты через внешние системы введите ID платежа для подтверждения.\n\n' +
      'Пример: /pay 123',
      {  }
    );
    return;
  }
  
  const paymentId = parseInt(args[1]);
  if (isNaN(paymentId)) {
    await ctx.reply('❌ Неверный ID платежа', { parse_mode: "HTML" });
    return;
  }
  
  try {
    const { confirmTestPayment } = require('./stars');
    const result = await confirmTestPayment(paymentId);
    
    if (result.success) {
      await ctx.reply(
        `✅ <b>Платеж подтвержден!</b>\n\n` +
        `Сумма: ${result.amount} ₽\n` +
        `Новый баланс: ${result.newBalance} ₽`,
        {  }
      );
    } else {
      await ctx.reply(`❌ ${result.message}`, { parse_mode: "HTML" });
    }
  } catch (error) {
    await ctx.reply(`❌ Ошибка: ${error.message}`, { parse_mode: "HTML" });
  }
});

// Команда для тестового пополнения баланса (работает без внешних сервисов)
bot.command('pay_test', async (ctx) => {
  const telegramId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  
  let amount = 100; // По умолчанию 100 рублей
  
  if (args.length >= 2) {
    amount = parseInt(args[1]);
    if (isNaN(amount) || amount < 10 || amount > 50000) {
      await ctx.reply(
        '❌ Неверная сумма. Введите число от 10 до 50000\n\n' +
        'Пример: /pay_test 500',
        {  }
      );
      return;
    }
  }
  
  try {
    const { updateUserBalance, createPayment } = require('./storage');
    
    // Создаем тестовый платеж
    const payment = createPayment(telegramId, amount, 'TEST', 0);
    
    // Сразу зачисляем баланс (симуляция успешной оплаты)
    const newBalance = updateUserBalance(telegramId, amount);
    
    // Обновляем статус платежа
    const { updatePaymentStatus } = require('./storage');
    updatePaymentStatus(payment.id, 'paid', 'test_payment', 'test_invoice');
    
    await ctx.reply(
      `✅ <b>Тестовый платеж успешно зачислен!</b>\n\n` +
      `💰 Сумма: +${amount} ₽\n` +
      `💳 Новый баланс: <b>${newBalance} ₽</b>\n\n` +
      `📝 Примечание: Это тестовый режим. В реальном приложении используйте Crypto Bot или Telegram Stars.`,
      {  }
    );
    
    console.log(`[Test] Платеж ${payment.id} на ${amount} ₽ зачислен пользователю ${telegramId}`);
    
  } catch (error) {
    await ctx.reply(`❌ Ошибка: ${error.message}`, { parse_mode: "HTML" });
  }
});

// Команда для получения информации об оплате
bot.command('payment_info', async (ctx) => {
  await ctx.reply(
    '💳 <b>Информация об оплате</b>\n\n' +
    '<b>Доступные способы:</b>\n\n' +
    '1️⃣ <b>Crypto Bot</b>\n' +
    '   • Работает с USDT\n' +
    '   • Требует токен от @CryptoBot\n' +
    '   • Работает на любом сервере\n\n' +
    '2️⃣ <b>Telegram Stars</b>\n' +
    '   • Требует публичный домен с HTTPS\n' +
    '   • Зарегистрированный Payment Provider\n' +
    '   • Не работает на localhost\n\n' +
    '<b>Тестовый режим:</b>\n' +
    '• /pay_test [сумма] - пополнить баланс без внешних систем\n\n' +
    '<b>Пример:</b>\n' +
    '/pay_test 500',
    {  }
  );
});

// Команда для активации Premium
bot.command('premium', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = getUserByTelegramId(telegramId);
  
  if (user.is_premium) {
    const expires = user.premium_expires_at ? new Date(user.premium_expires_at).toLocaleDateString('ru-RU') : 'неизвестно';
    await ctx.reply(
      `⭐ <b>Ваш Premium статус</b>\n\n` +
      `✅ Статус: Активен\n` +
      `📅 Действителен до: ${expires}\n` +
      `💰 Баланс: ${user.balance} руб.\n\n` +
      `💡 Следующее списание: 500 руб./месяц\n` +
      `⏰ Списывается автоматически пока баланс >= 500 руб.`,
      {  }
    );
    return;
  }
  
  const lang = getUserLanguage(telegramId);
  const currency = getUserCurrency(telegramId);
  const { formatBalance } = require('./storage');
  const costText = formatBalance(PREMIUM_COST, currency);
  const balanceText = formatBalance(user.balance, currency);
  
  if (lang === 'ru') {
    await ctx.reply(
      `⭐ <b>Активация Premium</b>\n\n` +
      `<b>Стоимость:</b> ${costText}/месяц\n` +
      `<b>Ваш баланс:</b> ${balanceText}\n` +
      `<b>Требуется:</b> минимум ${formatBalance(PREMIUM_MIN_BALANCE, currency)}\n\n` +
      `<b>Преимущества:</b>\n` +
      `✅ ∞ сканирование продуктов\n` +
      `✅ ∞ сканирование чеков ЖКХ\n` +
      `✅ Умный дом (MQTT + HA)\n` +
      `✅ Расширенная статистика\n\n` +
      `Для активации нажмите кнопку ниже или введите: /premium_activate`,
      { parse_mode: 'HTML', reply_markup: createProfileKeyboard(telegramId) }
    );
  } else {
    await ctx.reply(
      `⭐ <b>Premium Activation</b>\n\n` +
      `<b>Cost:</b> ${costText}/month\n` +
      `<b>Your balance:</b> ${balanceText}\n` +
      `<b>Required:</b> minimum ${formatBalance(PREMIUM_MIN_BALANCE, currency)}\n\n` +
      `<b>Benefits:</b>\n` +
      `✅ ∞ product scans\n` +
      `✅ ∞ receipt scans\n` +
      `✅ Smart Home (MQTT + HA)\n` +
      `✅ Extended statistics\n\n` +
      `Press the button below to activate or use: /premium_activate`,
      { parse_mode: 'HTML', reply_markup: createProfileKeyboard(telegramId) }
    );
  }
});

// Команда активации Premium
bot.command('premium_activate', async (ctx) => {
  const telegramId = ctx.from.id;
  const result = activatePremium(telegramId);
  
  const lang = getUserLanguage(telegramId);
  const currency = getUserCurrency(telegramId);
  const { formatBalance } = require('./storage');
  
  if (result.success) {
    await ctx.reply(
      `🎉 <b>Premium activated!</b>\n\n` +
      `${result.message}\n\n` +
      `💡 Now you can:\n` +
      `• Scan without limits\n` +
      `• Use Smart Home\n` +
      `• View extended statistics`,
      { parse_mode: 'HTML', reply_markup: createMainKeyboard(telegramId) }
    );
  } else {
    const balanceText = formatBalance(getUserByTelegramId(telegramId)?.balance || 0, currency);
    await ctx.reply(
      `❌ ${result.message}\n\n` +
      `💰 Top up your balance using /pay_test or via Crypto Bot`,
      { parse_mode: 'HTML', reply_markup: createMainKeyboard(telegramId) }
    );
  }
});

// Команда для проверки оплаты Crypto Bot (ручная)
bot.command('check_crypto', async (ctx) => {
  const args = ctx.message.text.split(' ');
  
  if (args.length < 2) {
    await ctx.reply(
      '🔍 <b>Проверка оплаты Crypto Bot</b>\n\n' +
      'Использование: /check_crypto <invoice_id>\n\n' +
      'После оплаты введите ID счета для проверки.\n\n' +
      'Пример: /check_crypto 123456',
      {  }
    );
    return;
  }
  
  const invoiceId = args[1];
  
  try {
    const { checkInvoice } = require('./cryptobot');
    const result = await checkInvoice(invoiceId);
    
    if (result.status === 'paid') {
      await ctx.reply(
        `✅ <b>Оплата подтверждена!</b>\n\n` +
        `ID счета: ${invoiceId}\n` +
        `Статус: Оплачен\n\n` +
        `💰 Баланс должен быть обновлен.`,
        {  }
      );
    } else {
      await ctx.reply(
        `⏳ <b>Ожидает оплаты</b>\n\n` +
        `ID счета: ${invoiceId}\n` +
        `Статус: ${result.status}\n\n` +
        `Оплатите счет по ссылке и попробуйте снова.`,
        {  }
      );
    }
  } catch (error) {
    await ctx.reply(`❌ Ошибка: ${error.message}`, { parse_mode: "HTML" });
  }
});

// Команда для просмотра тарифов
bot.command('tariffs', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = getUserByTelegramId(telegramId);
  
  const statusText = user.is_premium 
    ? '⭐ <b>Premium</b>' 
    : '👤 <b>Обычный</b>';
  
  await ctx.reply(
    `📋 <b>Тарифы и цены</b>\n\n` +
    `${statusText}\n\n` +
    `<b>Сканирование:</b>\n` +
    `• 🍎 Продукты: ${user.is_premium ? 'Бесплатно (∞)' : `5 руб./скан (3 бесплатно в неделю)`}\n` +
    `• 🧾 Чеки ЖКХ: ${user.is_premium ? 'Бесплатно (∞)' : `10 руб./скан (3 бесплатно в неделю)`}\n\n` +
    `<b>Premium:</b>\n` +
    `• Стоимость: ${PREMIUM_COST} руб./месяц\n` +
    `• Активация: от ${PREMIUM_COST} руб.\n` +
    `• Автосписание: каждый месяц\n` +
    `• При балансе < ${PREMIUM_COST} руб. - деактивируется\n\n` +
    `<b>Пополнение:</b>\n` +
    `• /pay_test [сумма] - тестовый режим\n` +
    `• Crypto Bot - реальная оплата\n` +
    `• Telegram Stars - реальная оплата`,
    {  }
  );
});

// === ОБРАБОТЧИКИ СООБЩЕНИЙ ===

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const state = ctx.session.state;
  const telegramId = ctx.from.id;
  const lang = getUserLanguage(telegramId);
  const user = getUserByTelegramId(telegramId);

  // Кнопка назад
  if (text === t(telegramId, 'buttons.back') || text === t(telegramId, 'buttons.cancel')) {
    ctx.session.state = 'idle';
    ctx.session.waitingForAmount = false;
    ctx.session.waitingForDeviceName = false;
    await sendMainMenu(ctx);
    return;
  }

  // Главное меню - кнопки
  if (text === t(telegramId, 'buttons.kitchen')) {
    ctx.session.state = 'waiting_food_photo';
    const { formatBalance, SCAN_PRICES } = require('./storage');
    const currency = getUserCurrency(telegramId);
    const priceText = formatBalance(SCAN_PRICES.product, currency);
    const kitchenText = t(telegramId, 'menu.kitchen') + `\n\n💰 Cost: ${priceText}/scan`;
    await ctx.reply(kitchenText, { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    return;
  }

  if (text === t(telegramId, 'buttons.receipts')) {
    ctx.session.state = 'waiting_receipt_photo';
    const { formatBalance, SCAN_PRICES } = require('./storage');
    const currency = getUserCurrency(telegramId);
    const priceText = formatBalance(SCAN_PRICES.receipt, currency);
    const receiptText = t(telegramId, 'menu.receipts') + `\n\n💰 Cost: ${priceText}/scan`;
    await ctx.reply(receiptText, { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    return;
  }

  if (text === t(telegramId, 'buttons.smart_home')) {
    if (!user.is_premium) {
      await ctx.reply(t(telegramId, 'smart_home.premium_required'), { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
      return;
    }
    ctx.session.state = 'smart_home';
    await ctx.reply(t(telegramId, 'menu.smart_home'), { parse_mode: "HTML", reply_markup: createSmartHomeKeyboard(telegramId) });
    return;
  }

  if (text === t(telegramId, 'buttons.stats')) {
    const stats = getStats(telegramId);
    const currency = getUserCurrency(telegramId);
    const { formatBalance } = require('./storage');
    const spentText = formatBalance(stats.totalSpent, currency);
    const isRu = lang === 'ru';
    
    const report = `📊 <b>${isRu ? 'Статистика' : 'Statistics'}</b>\n\n` +
      `🍎 ${isRu ? 'Продукты' : 'Products'}: ${stats.totalProducts}\n` +
      `🧾 ${isRu ? 'Чеки' : 'Receipts'}: ${stats.totalReceipts}\n` +
      `💰 ${isRu ? 'Потрачено' : 'Spent'}: ${spentText}\n` +
      `💡 ${isRu ? 'Устройства' : 'Devices'}: ${stats.totalDevices}\n\n` +
      `📊 ${isRu ? 'Лимиты недели' : 'Weekly limits'}:\n` +
      `├ 🍎: ${user.is_premium ? '∞' : stats.weeklyProductsLeft}\n` +
      `└ 🧾: ${user.is_premium ? '∞' : stats.weeklyReceiptsLeft}`;
    await ctx.reply(report, { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    return;
  }

  if (text === t(telegramId, 'buttons.profile')) {
    const stats = checkScanLimit(telegramId, 'product');
    const currency = getUserCurrency(telegramId);
    const balanceText = formatBalance(user.balance, currency);
    const isRu = lang === 'ru';
    
    await ctx.reply(
      `👤 <b>${isRu ? 'Профиль' : 'Profile'}</b>\n\n` +
      `ID: <code>${user.telegram_id}</code>\n` +
      `@${user.username || 'no'}\n` +
      `💰 ${isRu ? 'Баланс' : 'Balance'}: <b>${balanceText}</b>\n` +
      `💱 ${isRu ? 'Валюта' : 'Currency'}: ${currency}\n` +
      `⭐ Premium: ${user.is_premium ? '✅' : '❌'}\n\n` +
      `${t(telegramId, 'limits.scans_left', { 
        products: user.is_premium ? '∞' : stats.remaining,
        receipts: checkScanLimit(telegramId, 'receipt').remaining
      })}\n\n` +
      `💳 ${lang === 'ru' ? 'Пополнить баланс' : 'Top up balance'}:`,
      { parse_mode: "HTML", reply_markup: createProfileKeyboard(telegramId) }
    );
    return;
  }

  if (text === t(telegramId, 'buttons.settings')) {
    await ctx.reply(
      t(telegramId, 'menu.settings'),
      { parse_mode: "HTML", reply_markup: createSettingsKeyboard(telegramId) }
    );
    return;
  }

  // Настройки - язык
  if (text.includes(t(telegramId, 'buttons.language'))) {
    const newLang = lang === 'ru' ? 'en' : 'ru';
    setUserLanguage(telegramId, newLang);
    await ctx.reply(
      newLang === 'ru' ? '✅ Язык изменен на Русский' : '✅ Language changed to English',
      { parse_mode: "HTML", reply_markup: createSettingsKeyboard(telegramId) }
    );
    return;
  }

  // Настройки - уведомления
  if (text.includes(t(telegramId, 'buttons.notifications'))) {
    const current = getUserNotifications(telegramId);
    setUserNotifications(telegramId, !current);
    await ctx.reply(
      !current ? t(telegramId, 'settings.notifications_enabled') : t(telegramId, 'settings.notifications_disabled'),
      { parse_mode: "HTML", reply_markup: createSettingsKeyboard(telegramId) }
    );
    return;
  }

  // Пополнение баланса (Crypto Bot)
  if (text === t(telegramId, 'buttons.top_up_crypto') || text === '💰 Пополнить (Crypto)') {
    ctx.session.state = 'waiting_payment_amount';
    await ctx.reply(t(telegramId, 'payment.select_amount_crypto'), { parse_mode: "HTML", reply_markup: createPaymentAmountKeyboard(telegramId) });
    return;
  }

  // Пополнение через Telegram Stars
  if (text === t(telegramId, 'buttons.top_up_stars') || text === '⭐ Пополнить (Stars)') {
    ctx.session.state = 'waiting_stars_amount';
    await ctx.reply(t(telegramId, 'payment.select_amount_stars'), { parse_mode: "HTML", reply_markup: createStarsKeyboard(telegramId) });
    return;
  }

  // История платежей
  if (text === t(telegramId, 'buttons.payment_history')) {
    const { getPendingPayments } = require('./storage');
    const payments = getPendingPayments(telegramId);
    if (payments.length === 0) {
      await ctx.reply(t(telegramId, 'payment.no_history'), { parse_mode: "HTML", reply_markup: createProfileKeyboard(telegramId) });
      return;
    }
    let text = `📜 <b>${lang === 'ru' ? 'История платежей' : 'Payment history'}:</b>\n\n`;
    payments.forEach(p => {
      text += `💳 ${p.amount} ${p.currency} - ${p.status}\n`;
      text += `   └ ${formatDate(p.created_at, telegramId)}\n\n`;
    });
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: createProfileKeyboard(telegramId) });
    return;
  }

  // Premium информация
  if (text === t(telegramId, 'buttons.premium')) {
    const lang = getUserLanguage(telegramId);
    const currency = getUserCurrency(telegramId);
    const { formatBalance, PREMIUM_COST, PREMIUM_MIN_BALANCE } = require('./storage');
    const user = getUserByTelegramId(telegramId);
    const costText = formatBalance(PREMIUM_COST, currency);
    const balanceText = formatBalance(user?.balance || 0, currency);
    const minText = formatBalance(PREMIUM_MIN_BALANCE, currency);
    
    if (lang === 'ru') {
      const keyboard = new Keyboard()
        .text('⭐ Активировать Premium')
        .text(t(telegramId, 'buttons.back'))
        .resized();
      await ctx.reply(
        `⭐ <b>Premium статус</b>\n\n` +
        `<b>Стоимость:</b> ${costText}/месяц\n` +
        `<b>Ваш баланс:</b> ${balanceText}\n` +
        `<b>Требуется:</b> минимум ${minText}\n\n` +
        `<b>Преимущества:</b>\n` +
        `✅ ∞ сканирование продуктов\n` +
        `✅ ∞ сканирование чеков ЖКХ\n` +
        `✅ Умный дом (MQTT + HA)\n` +
        `✅ Расширенная статистика`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } else {
      const keyboard = new Keyboard()
        .text('⭐ Activate Premium')
        .text(t(telegramId, 'buttons.back'))
        .resized();
      await ctx.reply(
        `⭐ <b>Premium Status</b>\n\n` +
        `<b>Cost:</b> ${costText}/month\n` +
        `<b>Your balance:</b> ${balanceText}\n` +
        `<b>Required:</b> minimum ${minText}\n\n` +
        `<b>Benefits:</b>\n` +
        `✅ ∞ product scans\n` +
        `✅ ∞ receipt scans\n` +
        `✅ Smart Home (MQTT + HA)\n` +
        `✅ Extended statistics`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }
    return;
  }

  // Активация Premium по кнопке
  if (text === '⭐ Активировать Premium' || text === '⭐ Activate Premium') {
    const telegramId = ctx.from.id;
    const { activatePremium } = require('./storage');
    const result = activatePremium(telegramId);
    const lang = getUserLanguage(telegramId);
    const { formatBalance, PREMIUM_COST } = require('./storage');
    const currency = getUserCurrency(telegramId);
    const user = getUserByTelegramId(telegramId);
    
    if (result.success) {
      const costText = formatBalance(PREMIUM_COST, currency);
      const newBalance = formatBalance(user?.balance || 0, currency);
      if (lang === 'ru') {
        await ctx.reply(
          `🎉 <b>Premium активирован!</b>\n\n` +
          `✅ Premium активирован на 30 дней!\n` +
          `💰 Списано: ${costText}\n` +
          `💳 Новый баланс: ${newBalance}\n\n` +
          `💡 Теперь вы можете:\n` +
          `• Сканировать без ограничений\n` +
          `• Использовать умный дом\n` +
          `• Смотреть расширенную статистику`,
          { parse_mode: 'HTML', reply_markup: createMainKeyboard(telegramId) }
        );
      } else {
        await ctx.reply(
          `🎉 <b>Premium activated!</b>\n\n` +
          `✅ Premium activated for 30 days!\n` +
          `💰 Deducted: ${costText}\n` +
          `💳 New balance: ${newBalance}\n\n` +
          `💡 Now you can:\n` +
          `• Scan without limits\n` +
          `• Use Smart Home\n` +
          `• View extended statistics`,
          { parse_mode: 'HTML', reply_markup: createMainKeyboard(telegramId) }
        );
      }
    } else {
      if (lang === 'ru') {
        await ctx.reply(
          `❌ ${result.message}\n\n` +
          `💰 Пополните баланс через профиль`,
          { parse_mode: 'HTML', reply_markup: createProfileKeyboard(telegramId) }
        );
      } else {
        await ctx.reply(
          `❌ ${result.message}\n\n` +
          `💰 Top up your balance via profile`,
          { parse_mode: 'HTML', reply_markup: createProfileKeyboard(telegramId) }
        );
      }
    }
    return;
  }

  // Выбор валюты
  if (text === t(telegramId, 'buttons.currency')) {
    const { getAvailableCurrencies, getUserCurrency, setUserCurrency } = require('./storage');
    const currentCurrency = getUserCurrency(telegramId);
    const currencies = getAvailableCurrencies();
    const lang = getUserLanguage(telegramId);
    const isRu = lang === 'ru';
    
    const currencyNames = isRu ? {
      RUB: '🇷🇺 Рубли',
      USD: '🇺🇸 Доллары',
      EUR: '🇪🇺 Евро',
      CNY: '🇨🇳 Юани',
      TRY: '🇹🇷 Лиры',
      BYN: '🇧🇾 Бел. рубли',
      KZT: '🇰🇿 Тенге'
    } : {
      RUB: '🇷🇺 Russian Rubles',
      USD: '🇺🇸 US Dollars',
      EUR: '🇪🇺 Euros',
      CNY: '🇨🇳 Chinese Yuan',
      TRY: '🇹🇷 Turkish Lira',
      BYN: '🇧🇾 Belarusian Rubles',
      KZT: '🇰🇿 Tenge'
    };
    
    let textMsg = isRu ? '💱 <b>Выберите валюту</b>\n\nТекущая валюта: ' + currentCurrency : '💱 <b>Select currency</b>\n\nCurrent currency: ' + currentCurrency;
    
    const keyboard = new Keyboard();
    let row = [];
    for (const curr of currencies) {
      const label = (currentCurrency === curr ? '✅ ' : '') + currencyNames[curr];
      row.push(label);
      if (row.length === 2) {
        keyboard.text(row[0]).text(row[1]).row();
        row = [];
      }
    }
    if (row.length > 0) {
      keyboard.text(row[0]).row();
    }
    keyboard.text(t(telegramId, 'buttons.back'));
    
    await ctx.reply(textMsg, { parse_mode: 'HTML', reply_markup: keyboard.resized() });
    return;
  }

  // Обработка выбора валюты (проверяем по названиям)
  const currencyNamesShort = ['RUB', 'USD', 'EUR', 'CNY', 'TRY', 'BYN', 'KZT'];
  const isRu = lang === 'ru';
  const currencyNames = isRu ? {
    RUB: '🇷🇺 Рубли',
    USD: '🇺🇸 Доллары',
    EUR: '🇪🇺 Евро',
    CNY: '🇨🇳 Юани',
    TRY: '🇹🇷 Лиры',
    BYN: '🇧🇾 Бел. рубли',
    KZT: '🇰🇿 Тенге'
  } : {
    RUB: '🇷🇺 Russian Rubles',
    USD: '🇺🇸 US Dollars',
    EUR: '🇪🇺 Euros',
    CNY: '🇨🇳 Chinese Yuan',
    TRY: '🇹🇷 Turkish Lira',
    BYN: '🇧🇾 Belarusian Rubles',
    KZT: '🇰🇿 Tenge'
  };
  const selectedCurrency = currencyNamesShort.find(c => 
    text.includes(c) || (currencyNames[c] && text.includes(currencyNames[c].replace('✅ ', '')))
  );
  if (selectedCurrency) {
    setUserCurrency(telegramId, selectedCurrency);
    const { formatBalance } = require('./storage');
    const currency = getUserCurrency(telegramId);
    const balanceText = formatBalance(getUserByTelegramId(telegramId)?.balance || 0, currency);
    const msg = isRu 
      ? `✅ <b>Валюта изменена!</b>\n\nТеперь баланс отображается в ${selectedCurrency}\n💰 Ваш баланс: ${balanceText}`
      : `✅ <b>Currency changed!</b>\n\nNow balance is displayed in ${selectedCurrency}\n💰 Your balance: ${balanceText}`;
    await ctx.reply(msg, { parse_mode: "HTML", reply_markup: createProfileKeyboard(telegramId) });
    return;
  }

  // Выбор суммы (Crypto Bot)
  if (text.startsWith('💵 ')) {
    const amount = parseInt(text.replace('💵 ', ''));
    if (amount && amount > 0) {
      await handlePayment(ctx, amount, 'crypto');
    }
    return;
  }

  // Выбор Stars
  if (text.startsWith('⭐ ')) {
    const stars = parseInt(text.replace('⭐ ', ''));
    if (stars && stars > 0) {
      const rubAmount = convertStarsToRub(stars);
      await handlePayment(ctx, rubAmount, 'stars', stars);
    }
    return;
  }

  // Своя сумма
  if (text === t(telegramId, 'payment.custom_amount')) {
    const isStars = state === 'waiting_stars_amount';
    ctx.session.state = isStars ? 'waiting_custom_stars' : 'waiting_custom_amount';
    const msg = isStars 
      ? t(telegramId, 'payment.custom_amount') + '\n' + (lang === 'ru' ? '(Stars)' : '(in Stars)')
      : t(telegramId, 'payment.custom_amount');
    await ctx.reply(msg, { parse_mode: "HTML", reply_markup: new Keyboard().text(t(telegramId, 'buttons.back')).resized() });
    return;
  }

  // Ввод своей суммы
  if (state === 'waiting_custom_amount') {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < 10 || amount > 50000) {
      await ctx.reply(t(telegramId, 'errors.invalid_amount'), { parse_mode: "HTML", reply_markup: new Keyboard().text(t(telegramId, 'buttons.back')).resized() });
      return;
    }
    await handlePayment(ctx, amount, 'crypto');
    return;
  }

  // Ввод своих Stars
  if (state === 'waiting_custom_stars') {
    const stars = parseInt(text);
    if (isNaN(stars) || stars < 1) {
      await ctx.reply(lang === 'ru' ? '❌ Введите число от 1' : '❌ Enter a number from 1', { parse_mode: "HTML", reply_markup: new Keyboard().text(t(telegramId, 'buttons.back')).resized() });
      return;
    }
    const rubAmount = convertStarsToRub(stars);
    await handlePayment(ctx, rubAmount, 'stars', stars);
    return;
  }

  // Умный дом - все устройства
  if (text === t(telegramId, 'buttons.all_devices')) {
    if (!user.is_premium) {
      await ctx.reply(t(telegramId, 'smart_home.premium_required'), {  });
      return;
    }
    const devices = getDevices(telegramId);
    if (devices.length === 0) {
      await ctx.reply(t(telegramId, 'smart_home.no_devices'), { parse_mode: "HTML", reply_markup: createSmartHomeKeyboard(telegramId) });
      return;
    }
    for (const device of devices) {
      const inlineKeyboard = createDeviceInlineKeyboard(device);
      const statusEmoji = device.status === 'online' ? '🟢 Включено' : '🔴 Выключено';
      await ctx.reply(
        `💡 <b>${device.name}</b>\n\nТип: ${device.type}\nКомната: ${device.room || 'не указана'}\nСтатус: ${statusEmoji}`,
        { parse_mode: "HTML", inlineKeyboard }
      );
    }
    return;
  }

  // Умный дом - добавить устройство
  if (text === t(telegramId, 'buttons.add_device')) {
    if (!user.is_premium) {
      await ctx.reply(t(telegramId, 'smart_home.premium_required'), {  });
      return;
    }
    ctx.session.state = 'waiting_device_name';
    await ctx.reply(t(telegramId, 'smart_home.add_name'), { parse_mode: "HTML", reply_markup: new Keyboard().text(t(telegramId, 'buttons.back')).resized() });
    return;
  }

  // Добавление устройства - имя
  if (state === 'waiting_device_name' && text !== t(telegramId, 'buttons.back')) {
    ctx.session.tempDeviceName = text;
    ctx.session.state = 'waiting_device_type';
    await ctx.reply(t(telegramId, 'smart_home.add_type'), {  });
    return;
  }

  // Добавление устройства - тип
  if (state === 'waiting_device_type') {
    const typeMap = { '1': 'light', '2': 'switch', '3': 'thermostat', '4': 'camera', '5': 'sensor', 'light': 'light', 'switch': 'switch', 'thermostat': 'thermostat', 'camera': 'camera', 'sensor': 'sensor' };
    const deviceType = typeMap[text.toLowerCase()] || 'light';
    ctx.session.tempDeviceType = deviceType;
    ctx.session.state = 'waiting_device_room';
    await ctx.reply(t(telegramId, 'smart_home.add_room'), {  });
    return;
  }

  // Добавление устройства - комната
  if (state === 'waiting_device_room') {
    ctx.session.tempDeviceRoom = text;
    ctx.session.state = 'waiting_device_topic';
    await ctx.reply(t(telegramId, 'smart_home.add_topic'), {  });
    return;
  }

  // Добавление устройства - топик
  if (state === 'waiting_device_topic') {
    const mqttTopic = text === 'ha' ? '' : text;
    const device = addDevice(telegramId, {
      name: ctx.session.tempDeviceName,
      type: ctx.session.tempDeviceType,
      room: ctx.session.tempDeviceRoom,
      mqttTopic: mqttTopic,
      customData: text === 'ha' ? { entity_id: '' } : {}
    });
    await ctx.reply(
      t(telegramId, 'smart_home.device_added', { name: device.name, type: device.type, room: device.room }),
      { parse_mode: "HTML", reply_markup: createSmartHomeKeyboard(telegramId) }
    );
    ctx.session.state = 'smart_home';
    ctx.session.tempDeviceName = null;
    return;
  }

  // Ожидание фото
  if (state === 'waiting_food_photo' || state === 'waiting_receipt_photo') {
    await ctx.reply(t(telegramId, 'errors.photo_required'), { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    return;
  }

  await sendMainMenu(ctx);
});

/**
 * Обработка платежа
 */
async function handlePayment(ctx, amount, type, starsAmount = null) {
  const telegramId = ctx.from.id;
  ctx.session.state = 'idle';
  
  try {
    if (type === 'crypto') {
      const invoice = await createInvoice(telegramId, amount);
      await ctx.reply(
        t(telegramId, 'payment.invoice_created', { amount, url: invoice.payUrl }),
        { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
      );
    } else if (type === 'stars') {
      const payment = await createStarsPayment(telegramId, amount, starsAmount);
      await ctx.reply(
        `⭐ <b>${t(telegramId, 'payment.stars_title').replace('<b>', '').replace('</b>', '')}</b>\n\n` +
        `Stars: <b>${starsAmount} ⭐</b>\n` +
        `Сумма: <b>${amount} ₽</b>\n\n` +
        `${telegramId, 'payment.payment_received'}`,
        { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
      );
    }
  } catch (error) {
    await ctx.reply(t(telegramId, 'errors.payment_failed', { message: error.message }), { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
  }
}

// === CALLBACK QUERY (INLINE BUTTONS) ===

bot.on('callback_query:data', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const telegramId = ctx.from.id;
  const user = getUserByTelegramId(telegramId);

  await ctx.answerCallbackQuery();

  if (callbackData.startsWith('device_toggle_')) {
    const deviceId = parseInt(callbackData.replace('device_toggle_', ''));
    const device = getDeviceById(deviceId, telegramId);
    
    if (!device) {
      await ctx.editMessageText(t(telegramId, 'errors.device_not_found'));
      return;
    }

    try {
      let result;
      if (device.status === 'online') {
        result = await turnOffLight(deviceId, telegramId);
      } else {
        result = await turnOnLight(deviceId, telegramId);
      }
      await ctx.editMessageText(
        result.action === 'включено' || result.action === 'turned on'
          ? t(telegramId, 'smart_home.device_on', { device: result.device })
          : t(telegramId, 'smart_home.device_off', { device: result.device }),
        { parse_mode: 'HTML', reply_markup: createDeviceInlineKeyboard({ ...device, status: device.status === 'online' ? 'offline' : 'online' }) }
      );
    } catch (error) {
      await ctx.editMessageText(t(telegramId, 'errors.api_error', { message: error.message }));
    }
    return;
  }

  if (callbackData.startsWith('device_delete_')) {
    const deviceId = parseInt(callbackData.replace('device_delete_', ''));
    const device = getDeviceById(deviceId, telegramId);
    if (device) {
      deleteDevice(deviceId, telegramId);
      await ctx.editMessageText(`🗑️ Устройство "${device.name}" удалено`);
    }
    return;
  }

  if (callbackData.startsWith('device_logs_')) {
    const deviceId = parseInt(callbackData.replace('device_logs_', ''));
    const { getDeviceLogs } = require('./storage');
    const logs = getDeviceLogs(deviceId);
    
    if (logs.length === 0) {
      await ctx.editMessageText('📝 История пуста');
      return;
    }

    let text = '📝 <b>История действий:</b>\n\n';
    logs.slice(0, 10).forEach(log => {
      text += `• ${log.action} - ${log.status}\n`;
      text += `  └ ${formatDate(log.created_at, telegramId)}\n`;
    });
    await ctx.editMessageText(text, {  });
    return;
  }
});

// === ОБРАБОТКА ФОТО ===

async function handleFoodPhoto(ctx) {
  const telegramId = ctx.from.id;
  const photo = ctx.message.photo;
  
  if (!photo || photo.length === 0) {
    await ctx.reply(t(telegramId, 'errors.photo_required'));
    return;
  }

  // Проверка лимитов
  const limit = checkScanLimit(telegramId, 'product');
  if (!limit.allowed) {
    await ctx.reply(
      t(telegramId, 'limits.free_limit_reached', { limit: 3 }),
      { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
    );
    return;
  }

  await ctx.reply(t(telegramId, 'scanner.scanning'));

  try {
    const fileId = photo[photo.length - 1].file_id;
    const { downloadTelegramFile, askOpenRouter } = require('./openrouter');
    const imagePath = await downloadTelegramFile(bot, fileId);

    const systemPrompt = `Ты - эксперт по распознаванию продуктов питания. Проанализируй изображение и определи все продукты.

Верни строгий JSON формат:
{
  "products": [
    {"name": "название продукта", "category": "категория (фрукты/овощи/молочное/мясо/выпечка/напитки/другое)", "calories": "примерная калорийность на 100г в ккал (число)", "quantity": "количество", "expiry_date": "срок годности в формате YYYY-MM-DD если виден на упаковке, иначе null"}
  ],
  "summary": "краткое описание в 1-2 предложения"
}
Верни ТОЛЬКО валидный JSON.`;

    const result = await askOpenRouter(imagePath, systemPrompt);

    let parsed = null;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Ошибка парсинга:', parseError.message);
    }

    const { addProduct } = require('./storage');
    addProduct(telegramId, { rawResponse: result, parsed, imageFileId: fileId });
    
    // Списание средств за сканирование
    const charged = chargeForScan(telegramId, 'product');
    const user = getUserByTelegramId(telegramId);
    const costText = user.is_premium ? '(Premium - бесплатно)' : `(-${SCAN_PRICES.product} руб.)`;

    if (parsed?.products?.length > 0) {
      const productList = parsed.products.map(p => {
        let info = `• ${p.name} (${p.category || 'без категории'})`;
        if (p.calories) info += ` - ${p.calories} ккал/100г`;
        info += ` - ${p.quantity || '1 шт.'}`;
        if (p.expiry_date && p.expiry_date !== 'null') info += ` (годен до ${p.expiry_date})`;
        return info;
      }).join('\n');
      await ctx.reply(
        t(telegramId, 'scanner.products_found', { list: productList, summary: parsed.summary || '' }) + `\n\n💳 Стоимость: ${costText}\n💰 Баланс: ${user.balance} руб.`,
        { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
      );
    } else {
      await ctx.reply(`⚠️ Не удалось распознать.\n\n${result}`, { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    }

    ctx.session.state = 'idle';
  } catch (error) {
    console.error('Ошибка:', error);
    await ctx.reply(t(telegramId, 'scanner.error', { message: error.message }), { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    ctx.session.state = 'idle';
  }
}

async function handleReceiptPhoto(ctx) {
  const telegramId = ctx.from.id;
  const photo = ctx.message.photo;
  
  if (!photo || photo.length === 0) {
    await ctx.reply(t(telegramId, 'errors.photo_required'));
    return;
  }

  // Проверка лимитов
  const limit = checkScanLimit(telegramId, 'receipt');
  if (!limit.allowed) {
    await ctx.reply(
      t(telegramId, 'limits.free_limit_reached', { limit: 3 }),
      { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
    );
    return;
  }

  await ctx.reply(t(telegramId, 'scanner.scanning'));

  try {
    const fileId = photo[photo.length - 1].file_id;
    const { downloadTelegramFile, askOpenRouter } = require('./openrouter');
    const imagePath = await downloadTelegramFile(bot, fileId);

    const systemPrompt = `Ты - эксперт по анализу квитанций ЖКХ. Рассмотри изображение и извлеки данные.

Верни строгий JSON формат:
{
  "amount": "сумма к оплате цифрами",
  "period": "период (месяц и год, например: Май 2026)",
  "address": "адрес квартиры/дома",
  "accountNumber": "лицевой счет (если указан)",
  "serviceType": "тип услуги (электричество/вода/газ/отопление)",
  "meterReadings": {"electricity": "показания электросчетчика", "water": "показания водосчетчика", "gas": "показания газового счетчика"},
  "tariff": "тариф (если указан)",
  "penalties": "пени (если есть, инаме null)",
  "total": "итого к оплате (если отличается от amount)"
}
Верни ТОЛЬКО валидный JSON.`;

    const result = await askOpenRouter(imagePath, systemPrompt);

    let parsed = null;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Ошибка парсинга:', parseError.message);
    }

    const { addReceipt } = require('./storage');
    addReceipt(telegramId, { rawResponse: result, parsed, imageFileId: fileId });
    
    // Списание средств за сканирование чека
    const charged = chargeForScan(telegramId, 'receipt');
    const user = getUserByTelegramId(telegramId);
    const costText = user.is_premium ? '(Premium - бесплатно)' : `(-${SCAN_PRICES.receipt} руб.)`;

    if (parsed) {
      let info = '';
      if (parsed.amount) info += `💰 Сумма: ${parsed.amount}\n`;
      if (parsed.period) info += `📅 Период: ${parsed.period}\n`;
      if (parsed.address) info += `🏠 Адрес: ${parsed.address}\n`;
      if (parsed.accountNumber) info += `🏷️ Лицевой счёт: ${parsed.accountNumber}\n`;
      if (parsed.serviceType) info += `📄 Услуга: ${parsed.serviceType}\n`;
      if (parsed.meterReadings) {
        info += '\n📊 Показания счётчиков:\n';
        for (const [key, value] of Object.entries(parsed.meterReadings)) {
          if (value) {
            const label = { electricity: 'Электричество', water: 'Вода', gas: 'Газ' }[key] || key;
            info += `   • ${label}: ${value}\n`;
          }
        }
      }
      if (parsed.tariff) info += `\n💵 Тариф: ${parsed.tariff}\n`;
      if (parsed.penalties && parsed.penalties !== 'null') info += `⚠️ Пени: ${parsed.penalties}\n`;
      if (parsed.total) info += `💳 Итого: ${parsed.total}\n`;
      info += `\n💳 Стоимость: ${costText}\n💰 Баланс: ${user.balance} руб.`;
      await ctx.reply(t(telegramId, 'scanner.receipt_found', { info }), { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    } else {
      await ctx.reply(`⚠️ Не удалось извлечь данные.\n\n${result}`, { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    }

    ctx.session.state = 'idle';
  } catch (error) {
    console.error('Ошибка:', error);
    await ctx.reply(t(telegramId, 'scanner.error', { message: error.message }), { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) });
    ctx.session.state = 'idle';
  }
}

bot.on('message:photo', async (ctx) => {
  const state = ctx.session.state;
  const telegramId = ctx.from.id;

  if (state === 'waiting_food_photo') {
    await handleFoodPhoto(ctx);
  } else if (state === 'waiting_receipt_photo') {
    await handleReceiptPhoto(ctx);
  } else {
    await ctx.reply(
      t(telegramId, 'errors.photo_required'),
      { parse_mode: "HTML", reply_markup: createMainKeyboard(telegramId) }
    );
  }
});

// === ЗАВЕРШЕНИЕ ===

bot.catch((err) => {
  console.error('Ошибка бота:', err);
});

// Подключение MQTT при запуске
connectMQTT();

// Инициализация напоминаний
initReminders(bot);

// Обработка выключения
process.on('SIGINT', () => {
  console.log('\nВыключение бота...');
  disconnectMQTT();
  process.exit(0);
});

module.exports = { bot, createMainKeyboard, createSmartHomeKeyboard, createProfileKeyboard };