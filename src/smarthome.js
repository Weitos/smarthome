const mqtt = require('mqtt');
const axios = require('axios');
const { addDeviceLog } = require('./storage');

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const HOME_ASSISTANT_URL = process.env.HOME_ASSISTANT_URL || '';
const HOME_ASSISTANT_TOKEN = process.env.HOME_ASSISTANT_TOKEN || '';

let mqttClient = null;

function connectMQTT() {
  if (!MQTT_BROKER || MQTT_BROKER === 'mqtt://localhost:1883') {
    console.log('⚠️ MQTT не настроен. Используется режим симуляции.');
    return null;
  }

  try {
    mqttClient = mqtt.connect(MQTT_BROKER, {
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      clientId: 'smart-home-bot-' + Math.random().toString(16).substr(2, 8),
      reconnectPeriod: 5000,
      connectTimeout: 10000
    });

    mqttClient.on('connect', () => {
      console.log('✅ Подключено к MQTT брокеру');
      mqttClient.subscribe('smart-home/+/status', (err) => {
        if (err) console.error('Ошибка подписки:', err);
      });
    });

    mqttClient.on('error', (err) => {
      console.error('Ошибка MQTT:', err.message);
    });

    mqttClient.on('message', (topic, message) => {
      console.log(`📩 MQTT: ${topic} -> ${message.toString()}`);
    });

    return mqttClient;
  } catch (error) {
    console.error('Не удалось подключиться к MQTT:', error.message);
    return null;
  }
}

async function turnOnLight(deviceId, userId) {
  const device = require('./storage').getDeviceById(deviceId, userId);
  if (!device) {
    throw new Error('Устройство не найдено');
  }

  console.log(`[Умный дом] Включение света: ${device.name} (${device.mqtt_topic})`);

  if (mqttClient && device.mqtt_topic) {
    mqttClient.publish(`${device.mqtt_topic}/set`, 'ON', { qos: 1 });
  } else if (HOME_ASSISTANT_URL && device.custom_data?.entity_id) {
    try {
      await axios.post(
        `${HOME_ASSISTANT_URL}/api/services/light/turn_on`,
        { entity_id: device.custom_data.entity_id },
        { headers: { Authorization: `Bearer ${HOME_ASSISTANT_TOKEN}` } }
      );
    } catch (error) {
      console.error('HA Error:', error.message);
      throw new Error('Не удалось включить через Home Assistant');
    }
  }

  require('./storage').updateDeviceStatus(deviceId, userId, 'online');
  addDeviceLog(deviceId, 'turn_on', 'success', `Включено: ${device.name}`);

  return { success: true, device: device.name, action: 'включено' };
}

async function turnOffLight(deviceId, userId) {
  const device = require('./storage').getDeviceById(deviceId, userId);
  if (!device) {
    throw new Error('Устройство не найдено');
  }

  console.log(`[Умный дом] Выключение света: ${device.name} (${device.mqtt_topic})`);

  if (mqttClient && device.mqtt_topic) {
    mqttClient.publish(`${device.mqtt_topic}/set`, 'OFF', { qos: 1 });
  } else if (HOME_ASSISTANT_URL && device.custom_data?.entity_id) {
    try {
      await axios.post(
        `${HOME_ASSISTANT_URL}/api/services/light/turn_off`,
        { entity_id: device.custom_data.entity_id },
        { headers: { Authorization: `Bearer ${HOME_ASSISTANT_TOKEN}` } }
      );
    } catch (error) {
      console.error('HA Error:', error.message);
      throw new Error('Не удалось выключить через Home Assistant');
    }
  }

  require('./storage').updateDeviceStatus(deviceId, userId, 'offline');
  addDeviceLog(deviceId, 'turn_off', 'success', `Выключено: ${device.name}`);

  return { success: true, device: device.name, action: 'выключено' };
}

async function setBrightness(deviceId, userId, brightness) {
  if (brightness < 0 || brightness > 100) {
    throw new Error('Яркость должна быть от 0 до 100');
  }

  const device = require('./storage').getDeviceById(deviceId, userId);
  if (!device) {
    throw new Error('Устройство не найдено');
  }

  if (mqttClient && device.mqtt_topic) {
    mqttClient.publish(`${device.mqtt_topic}/set`, JSON.stringify({ brightness }), { qos: 1 });
  }

  addDeviceLog(deviceId, 'set_brightness', 'success', `Яркость: ${brightness}%`);
  return { success: true, brightness };
}

async function getDeviceStatus(deviceId, userId) {
  const device = require('./storage').getDeviceById(deviceId, userId);
  if (!device) {
    throw new Error('Устройство не найдено');
  }

  let status = device.status;
  let additionalInfo = {};

  if (HOME_ASSISTANT_URL && device.custom_data?.entity_id) {
    try {
      const response = await axios.get(
        `${HOME_ASSISTANT_URL}/api/states/${device.custom_data.entity_id}`,
        { headers: { Authorization: `Bearer ${HOME_ASSISTANT_TOKEN}` } }
      );
      status = response.data.state;
      additionalInfo = response.data.attributes;
    } catch (error) {
      console.error('HA Status Error:', error.message);
    }
  }

  return { device, status, additionalInfo };
}

async function toggleDevice(deviceId, userId) {
  const device = require('./storage').getDeviceById(deviceId, userId);
  if (!device) {
    throw new Error('Устройство не найдено');
  }

  if (device.status === 'online') {
    return await turnOffLight(deviceId, userId);
  } else {
    return await turnOnLight(deviceId, userId);
  }
}

async function getAllDeviceStatuses(userId) {
  const devices = require('./storage').getDevices(userId);
  const results = [];

  for (const device of devices) {
    try {
      const statusData = await getDeviceStatus(device.id, userId);
      results.push(statusData);
    } catch (error) {
      results.push({ device, status: 'unknown', error: error.message });
    }
  }

  return results;
}

function disconnectMQTT() {
  if (mqttClient) {
    mqttClient.end();
    console.log('📴 Отключен от MQTT брокера');
  }
}

module.exports = {
  connectMQTT,
  disconnectMQTT,
  turnOnLight,
  turnOffLight,
  setBrightness,
  getDeviceStatus,
  toggleDevice,
  getAllDeviceStatuses
};