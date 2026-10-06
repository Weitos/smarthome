/**
 * Модуль интеграции с OpenRouter API
 * Использует официальный SDK для работы с AI
 * Модель: google/gemma-4-31b-it:free
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemma-4-31b-it:free'; // Vision-capable model

/**
 * Отправка изображения в OpenRouter API для анализа
 * @param {string} imagePath - Путь к файлу изображения
 * @param {string} systemPrompt - Системный промпт с инструкциями
 * @returns {Promise<string>} - Ответ от API
 */
async function askOpenRouter(imagePath, systemPrompt) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY не настроен в .env');
  }

  let base64Image;
  
  // Проверяем, является ли путь URL или локальным файлом
  if (imagePath.startsWith('http')) {
    const response = await axios({ url: imagePath, method: 'GET', responseType: 'arraybuffer' });
    base64Image = Buffer.from(response.data).toString('base64');
  } else {
    base64Image = fs.readFileSync(imagePath, { encoding: 'base64' });
  }

  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`
          }
        }
      ]
    }
  ];

  try {
    const response = await axios.post(
      OPENROUTER_URL,
      {
        model: MODEL,
        messages: messages,
        max_tokens: 2048,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://telegram.me',
          'X-Title': 'Smart Home Bot'
        }
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error('Пустой ответ от API');
    }

    console.log(`[OpenRouter] Модель: ${MODEL}`);
    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      console.error('Ошибка API:', status, data);
      throw new Error(`Ошибка API (${status}): ${data.error?.message || 'Неизвестная ошибка'}`);
    } else if (error.request) {
      console.error('Нет ответа от API:', error.message);
      throw new Error('Нет ответа от API. Проверьте подключение к интернету.');
    } else {
      console.error('Ошибка запроса:', error.message);
      throw error;
    }
  }
}

/**
 * Отправка текстового сообщения в OpenRouter
 * @param {string} systemPrompt - Системный промпт
 * @param {string} userMessage - Сообщение пользователя
 * @returns {Promise<string>} - Ответ от API
 */
async function askText(systemPrompt, userMessage) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY не настроен в .env');
  }

  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: userMessage
    }
  ];

  try {
    const response = await axios.post(
      OPENROUTER_URL,
      {
        model: MODEL,
        messages: messages,
        max_tokens: 1024,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://telegram.me',
          'X-Title': 'Smart Home Bot'
        }
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error('Пустой ответ от API');
    }

    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      console.error('Ошибка API:', status, data);
      throw new Error(`Ошибка API (${status}): ${data.error?.message || 'Неизвестная ошибка'}`);
    } else if (error.request) {
      throw new Error('Нет ответа от API');
    } else {
      throw error;
    }
  }
}

/**
 * Скачивание файла из Telegram и сохранение во временную папку
 * @param {object} bot - Экземпляр бота
 * @param {string} fileId - ID файла в Telegram
 * @returns {Promise<string>} - Путь к сохраненному файлу
 */
async function downloadTelegramFile(bot, fileId) {
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const file = await bot.api.getFile(fileId);
  const filePath = path.join(tempDir, `${Date.now()}_${path.basename(file.file_path)}`);

  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  
  const response = await axios({
    url: fileUrl,
    method: 'GET',
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', reject);
  });
}

/**
 * Очистка старых временных файлов
 */
function cleanTempFiles(maxAgeMs = 3600000) {
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) return;

  const now = Date.now();
  const files = fs.readdirSync(tempDir);

  for (const file of files) {
    const filePath = path.join(tempDir, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > maxAgeMs) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = {
  askOpenRouter,
  askText,
  downloadTelegramFile,
  cleanTempFiles
};