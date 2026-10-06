const { getProducts, getReceipts, getDevices, getDeviceLogs, getStats } = require('./storage');

function formatDate(dateStr) {
  if (!dateStr) return 'Нет данных';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', { 
    day: 'numeric', 
    month: 'short', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function getProductStats(telegramId) {
  const products = getProducts(telegramId, 1000);
  
  const categories = {};
  products.forEach(p => {
    const cat = p.category || 'Без категории';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  const sorted = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const recentProducts = products.slice(0, 10);

  return {
    total: products.length,
    byCategory: sorted,
    recent: recentProducts,
    oldestDate: products[products.length - 1]?.created_at,
    newestDate: products[0]?.created_at
  };
}

function getReceiptStats(telegramId) {
  const receipts = getReceipts(telegramId, 1000);
  
  const serviceTypes = {};
  const totalSpent = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);

  receipts.forEach(r => {
    const type = r.service_type || 'Другое';
    serviceTypes[type] = (serviceTypes[type] || 0) + 1;
  });

  const byMonth = {};
  receipts.forEach(r => {
    if (r.period) {
      const month = r.period;
      if (!byMonth[month]) {
        byMonth[month] = { count: 0, total: 0 };
      }
      byMonth[month].count += 1;
      byMonth[month].total += r.amount || 0;
    }
  });

  return {
    total: receipts.length,
    totalSpent,
    byServiceType: Object.entries(serviceTypes).sort((a, b) => b[1] - a[1]),
    byMonth: Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])),
    average: receipts.length > 0 ? totalSpent / receipts.length : 0,
    recent: receipts.slice(0, 5)
  };
}

function getDeviceStats(telegramId) {
  const devices = getDevices(telegramId);
  
  const deviceTypes = {};
  const deviceStatuses = { online: 0, offline: 0, unknown: 0 };

  devices.forEach(d => {
    deviceTypes[d.type] = (deviceTypes[d.type] || 0) + 1;
    if (d.status === 'online') deviceStatuses.online++;
    else if (d.status === 'offline') deviceStatuses.offline++;
    else deviceStatuses.unknown++;
  });

  return {
    total: devices.length,
    byType: Object.entries(deviceTypes),
    byStatus: deviceStatuses,
    list: devices.map(d => ({
      id: d.id,
      name: d.name,
      type: d.type,
      room: d.room,
      status: d.status,
      updated: formatDate(d.updated_at)
    }))
  };
}

function getFullStats(telegramId) {
  const baseStats = getStats(telegramId);
  const productStats = getProductStats(telegramId);
  const receiptStats = getReceiptStats(telegramId);
  const deviceStats = getDeviceStats(telegramId);

  return {
    user: baseStats.user,
    products: productStats,
    receipts: receiptStats,
    devices: deviceStats,
    generatedAt: new Date().toISOString()
  };
}

function generateStatsReport(telegramId) {
  const stats = getFullStats(telegramId);
  
  let report = `📊 <b>Статистика</b>\n\n`;
  
  report += `👤 <b>Пользователь:</b>\n`;
  report += `├ Баланс: ${stats.user.balance} ₽\n`;
  report += `└ Премиум: ${stats.user.is_premium ? '✅ Да' : '❌ Нет'}\n\n`;

  report += `🍎 <b>Продукты:</b>\n`;
  report += `├ Всего: ${stats.products.total}\n`;
  if (stats.products.byCategory.length > 0) {
    report += `└ Топ категории: ${stats.products.byCategory.slice(0, 3).map(c => `${c[0]} (${c[1]})`).join(', ')}\n`;
  }

  report += `\n🧾 <b>Чеки:</b>\n`;
  report += `├ Всего: ${stats.receipts.total}\n`;
  report += `├ Потрачено: ${stats.receipts.totalSpent.toFixed(2)} ₽\n`;
  report += `└ Средний чек: ${stats.receipts.average.toFixed(2)} ₽\n`;

  report += `\n💡 <b>Устройства:</b>\n`;
  report += `├ Всего: ${stats.devices.total}\n`;
  report += `├ Онлайн: ${stats.devices.byStatus.online}\n`;
  report += `└ Офлайн: ${stats.devices.byStatus.offline}\n`;

  return report;
}

function generateProductList(telegramId, limit = 20) {
  const products = getProducts(telegramId, limit);
  
  if (products.length === 0) {
    return '📦 Нет сохраненных продуктов';
  }

  let text = `📦 <b>Последние продукты (${products.length}):</b>\n\n`;
  
  products.forEach((p, i) => {
    text += `${i + 1}. ${p.name}`;
    if (p.category) text += ` (${p.category})`;
    if (p.quantity) text += ` - ${p.quantity}`;
    text += `\n   └ ${formatDate(p.created_at)}\n`;
  });

  return text;
}

function generateReceiptList(telegramId, limit = 10) {
  const receipts = getReceipts(telegramId, limit);
  
  if (receipts.length === 0) {
    return '🧾 Нет сохраненных чеков';
  }

  let text = `🧾 <b>Последние чеки (${receipts.length}):</b>\n\n`;
  
  receipts.forEach((r, i) => {
    text += `${i + 1}. ${r.service_type || 'Услуга'}`;
    if (r.amount) text += ` - ${r.amount} ₽`;
    text += `\n`;
    if (r.period) text += `   📅 ${r.period}\n`;
    text += `   └ ${formatDate(r.created_at)}\n`;
  });

  return text;
}

module.exports = {
  getProductStats,
  getReceiptStats,
  getDeviceStats,
  getFullStats,
  generateStatsReport,
  generateProductList,
  generateReceiptList,
  formatDate
};