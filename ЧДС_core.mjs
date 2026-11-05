export const QUANTILES = ['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9'];

export function parseCSV(input) {
  const txt = String(input ?? '').replace(/^\uFEFF/, '');
  const firstLine = txt.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const grid = [];
  let row = [], cell = '', quote = false;
  for (let i = 0; i < txt.length; i++) {
    const char = txt[i];
    if (char === '"') {
      if (quote && txt[i + 1] === '"') { cell += '"'; i++; }
      else quote = !quote;
    } else if (!quote && char === delimiter) {
      row.push(cell); cell = '';
    } else if (!quote && (char === '\n' || char === '\r')) {
      if (char === '\r' && txt[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) grid.push(row);
      row = [];
    } else { cell += char; }
  }
  if (quote) throw new Error('Некорректный CSV: не закрыты кавычки.');
  row.push(cell);
  if (row.some(v => v.trim() !== '')) grid.push(row);
  if (grid.length < 2) throw new Error('В CSV нет данных или заголовков.');
  const headers = grid.shift().map(x => x.trim());
  return grid.map((values, idx) => {
    if (values.length !== headers.length) throw new Error(`Ошибка CSV: строка ${idx + 2} содержит ${values.length} столбцов, ожидалось ${headers.length}.`);
    return Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? '').trim()]));
  });
}

export function asNumber(value, label) {
  const x = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(x)) throw new Error(`Некорректное значение «${label}»: ${value}`);
  return x;
}

export function validateData(forecasts, routes) {
  if (!forecasts.length || !routes.length) throw new Error('Один из файлов пуст.');
  for (const key of ['route', 'date', 'seats', '0.5_base_demand']) {
    if (!(key in forecasts[0])) throw new Error(`В ЧДС_my_forecast.csv отсутствует столбец ${key}.`);
  }
  for (const key of ['route', 'base_price', 'price_sensitivity', 'cost_per_passenger']) {
    if (!(key in routes[0])) throw new Error(`В ЧДС_routes.csv отсутствует столбец ${key}.`);
  }
  const routeMap = new Map(routes.map(row => [row.route, row]));
  const seen = new Set();
  forecasts.forEach((row, idx) => {
    if (!routeMap.has(row.route)) throw new Error(`Для маршрута ${row.route} нет параметров в ЧДС_routes.csv.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Некорректная дата в строке ${idx + 2}: ${row.date}`);
    if (seen.has(row.route + '|' + row.date)) throw new Error(`Повторение рейса ${row.route} за ${row.date}`);
    seen.add(row.route + '|' + row.date);
    if (asNumber(row.seats, 'seats') < 0) throw new Error('Количество мест не может быть отрицательным.');
    for (const q of QUANTILES) if (row[`${q}_base_demand`] !== undefined) asNumber(row[`${q}_base_demand`], `${q}_base_demand`);
  });
  routes.forEach(row => {
    if (asNumber(row.base_price, 'base_price') < 0) throw new Error('Базовая цена отрицательна.');
    if (asNumber(row.price_sensitivity, 'price_sensitivity') < 0) throw new Error('Чувствительность к цене отрицательна.');
    asNumber(row.cost_per_passenger, 'cost_per_passenger');
  });
  return true;
}

export function computeScenario(forecast, route, price, quantile = '0.5') {
  if (!QUANTILES.includes(quantile)) throw new Error('Неизвестный квантиль.');
  const baseline = asNumber(forecast[`${quantile}_base_demand`], `${quantile}_base_demand`);
  const seats = asNumber(forecast.seats, 'seats');
  const sensitivity = asNumber(route.price_sensitivity, 'price_sensitivity');
  const basePrice = asNumber(route.base_price, 'base_price');
  const cost = asNumber(route.cost_per_passenger, 'cost_per_passenger');
  const asking = Math.max(0, baseline - sensitivity * (price - basePrice));
  const sold = Math.min(seats, asking);
  return { asking, sold, free: Math.max(0, seats - sold), seats,
    expectedRevenue: price * sold, expectedMargin: (price - cost) * sold,
    basePrice, price, quantile, baseline };
}

export function allScenarios(forecast, route, price) {
  return QUANTILES.map(q => ({...computeScenario(forecast, route, price, q), q }));
}

export const CITY_NAMES = { MOW:'Москва', AER:'Сочи', LED:'Санкт-Петербург', OVB:'Новосибирск', KGD:'Калининград', MRV:'Минеральные Воды' };
export function routeLabel(code) {
  return code.split('-').map(c => CITY_NAMES[c] || c).join(' → ');
}
