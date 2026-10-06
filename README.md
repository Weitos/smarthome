# Telegram Bot for Smart Home 🏠🤖

Многофункциональный Telegram-бот для управления умным домом с интеграцией AI, анализом продуктов и сканированием квитанций ЖКХ.

## 📋 Возможности

### 🍎 Распознавание продуктов
- Отправьте фото продуктов - бот распознает названия, категорию и количество
- Сохранение истории покупок
- Отслеживание срока годности с напоминаниями за 48 часов

### 🧾 Сканирование квитанций ЖКХ
- Автоматическое извлечение суммы, периода, показаний счетчиков
- Напоминания об оплате за 48 часов до срока
- История платежей

### 💡 Умный дом
- Управление устройствами через MQTT
- Интеграция с Home Assistant
- Включение/выключение света, розеток, термостатов
- Логирование действий

### 💳 Оплата
- **Crypto Bot** - оплата криптовалютой (USDT)
- **Telegram Stars** - оплата Stars (1 Stars = 2 ₽)

### ⭐ Premium
- Безлимитные сканирования
- Доступ к умному дому
- Расширенная статистика

### 📊 Лимиты (бесплатно)
- 3 сканирования продуктов в неделю
- 3 сканирования чеков ЖКХ в неделю

### 🌐 Многоязычность
- Русский (по умолчанию)
- Английский
- Переключение в настройках

## 🛠 Установка

```bash
# Клонирование репозитория
git clone <repository-url>
cd smart-home-bot

# Установка зависимостей
npm install

# Настройка переменных окружения
cp .env.example .env
# Отредактируйте .env со своими токенами
```

## ⚙️ Настройка .env

```env
# Обязательно
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENROUTER_API_KEY=your_openrouter_api_key

# Опционально - для оплаты
CRYPTO_BOT_TOKEN=your_crypto_bot_token

# Для умного дома (MQTT)
MQTT_BROKER=mqtt://localhost:1883
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password

# Для Home Assistant
HOME_ASSISTANT_URL=http://192.168.1.100:8123
HOME_ASSISTANT_TOKEN=your_home_assistant_token

# Сервер
PORT=3000
```

## 🚀 Запуск

```bash
# Запуск бота
npm start

# Или в режиме разработки (с перезагрузкой)
npm run dev
```

## 📁 Структура проекта

```
smart-home-bot/
├── src/
│   ├── bot.js              # Основной бот (grammY)
│   ├── index.js            # Точка входа
│   ├── storage.js          # SQLite хранилище
│   ├── db/secure.js        # Защищенная БД
│   ├── i18n.js             # Интернационализация
│   ├── openrouter.js       # AI (google/gemma-4-31b-it:free)
│   ├── smarthome.js        # MQTT + Home Assistant
│   ├── cryptobot.js        # Crypto Bot оплата
│   ├── stars.js            # Telegram Stars оплата
│   └── reminders.js        # Напоминания (cron)
├── data/
│   ├── i18n/               # Переводы (ru.json, en.json)
│   └── bot.db              # SQLite база
├── .env.example            # Пример настроек
└── package.json
```

## 🔧 Команды бота

- `/start` - Главное меню
- `/help` - Справка
- `/profile` - Профиль и баланс
- `/devices` - Управление устройствами (Premium)
- `/stats` - Статистика
- `/pay <ID>` - Подтверждение платежа (для тестирования)

## 🛡 Безопасность

- Защита от SQL-инъекций через parameterized queries
- Хранение токенов в переменных окружения
- Валидация входных данных

## 📝 TODO

- [ ] Добавить больше типов устройств
- [ ] Реализовать расписания
- [ ] Добавить аналитику расходов
- [ ] Интеграция с другими умными домами

## 📄 Лицензия

MIT License

## 👨‍💻 Автор

Создано с использованием:
- [grammY](https://grammy.dev/) - Telegram Bot Framework
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite
- [OpenRouter](https://openrouter.ai/) - AI API