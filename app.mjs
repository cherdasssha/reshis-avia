import { parseCSV, validateData, computeScenario, allScenarios, QUANTILES, CITY_NAMES, routeLabel, asNumber } from './core.mjs';

const $ = id => document.getElementById(id);
const money = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';
const count = n => Math.round(n).toLocaleString('ru-RU');
let forecasts = null, routes = null;
let selectedForecast = null, selectedRoute = null;
const filesState = {forecast: null, routes: null};

function showStatus(text, type = '') {
  $('status').className = 'data-status ' + type;
  $('status').lastElementChild.textContent = text;
}
function setOptions(select, entries) {
  select.replaceChildren();
  entries.forEach(([value,label]) => select.add(new Option(label,value)));
}
function dataReady() { return forecasts && routes; }
function setEnabled(isReady) {
  ['departure','destination','flight-date','ticket-price','price-range','base-price-btn','optimal-btn'].forEach(id => $(id).disabled = !isReady);
}
function makeRouteMap() { return new Map(routes.map(r => [r.route,r])); }
function makeForecastMap() { return new Map(forecasts.map(r => [r.route+'|'+r.date,r])); }
function refreshRoutes() {
  const ids = [...new Set(forecasts.map(f => f.route).filter(id => routes.some(r => r.route === id)))].sort();
  const origins = [...new Set(ids.map(i => i.split('-')[0]))];
  setOptions($('departure'), origins.map(i => [i,CITY_NAMES[i] || i]));
  refreshDestinations();
}
function refreshDestinations(preferred) {
  const origin = $('departure').value;
  const targets = [...new Set(forecasts.map(f => f.route).filter(id => id.startsWith(origin+'-')).map(id => id.split('-')[1]))].sort();
  setOptions($('destination'), targets.map(i => [i,CITY_NAMES[i] || i]));
  if (targets.includes(preferred)) $('destination').value = preferred;
  refreshDates();
}
function selectedRouteCode() { return $('departure').value + '-' + $('destination').value; }
function refreshDates() {
  const code = selectedRouteCode();
  const dates = forecasts.filter(row => row.route === code).map(row => row.date).sort();
  const selectDate = $('flight-date');
  if (!dates.length) { showStatus('Для выбранного маршрута нет прогнозных дат.', 'error'); return; }
  selectDate.min = dates[0]; selectDate.max = dates.at(-1);
  if (!dates.includes(selectDate.value)) selectDate.value = dates[0];
  refreshPrice(true);
}
function refreshPrice(reset) {
  const code = selectedRouteCode(), day = $('flight-date').value;
  selectedForecast = makeForecastMap().get(code+'|'+day);
  selectedRoute = makeRouteMap().get(code);
  if (!selectedForecast || !selectedRoute) {
    showStatus(`Нет прогноза на ${day} для маршрута ${code}. Выбери другую дату.`, 'error');
    return;
  }
  const base = asNumber(selectedRoute.base_price, 'base_price');
  const min = selectedRoute.price_min === undefined ? Math.max(0, base * 0.5) : asNumber(selectedRoute.price_min,'price_min');
  const max = selectedRoute.price_max === undefined ? base * 2 : asNumber(selectedRoute.price_max,'price_max');
  $('ticket-price').min = String(min); $('ticket-price').max = String(max);
  $('price-range').min = String(min); $('price-range').max = String(max);
  $('price-min').textContent = money(min); $('price-max').textContent = money(max);
  const rec = Number(selectedForecast['0.5_price']);
  const recommended = Number.isFinite(rec) && rec > 0 ? rec : null;
  $('base-hint').textContent = `Базовая: ${money(base)}.${recommended ? ` Рекомендованная по медиане: ${money(recommended)}.` : ''}`;
  $('optimal-btn').disabled = !recommended;
  $('optimal-btn').dataset.price = String(recommended ?? '');
  $('base-price-btn').dataset.price = String(base);
  if (reset || !Number.isFinite(Number($('ticket-price').value))) $('ticket-price').value = String(base);
  $('price-range').value = $('ticket-price').value;
  recalculate();
}
function recalculate() {
  if (!selectedForecast || !selectedRoute) return;
  const price = Number($('ticket-price').value);
  if (!Number.isFinite(price) || price < 0) { showStatus('Введи корректную неотрицательную цену.', 'error'); return; }
  const stats = computeScenario(selectedForecast, selectedRoute, price);
  const series = allScenarios(selectedForecast, selectedRoute, price);
  $('result-route').textContent = routeLabel(selectedForecast.route);
  $('demand-value').textContent = count(stats.asking);
  $('sales-value').textContent = count(stats.sold);
  $('seats-value').textContent = count(stats.seats);
  $('free-value').textContent = count(stats.free);
  const occupancy = stats.seats > 0 ? stats.sold / stats.seats * 100 : 0;
  $('occupancy-label').textContent = occupancy.toFixed(1).replace('.',',') + '%';
  $('occupancy-bar').style.width = Math.min(100,occupancy) + '%';
  $('revenue-value').textContent = money(stats.expectedRevenue);
  $('profit-value').textContent = money(stats.expectedMargin);
  $('interval-value').textContent = `${count(series[0].asking)}–${count(series[8].asking)} чел.`;
  $('median-value').textContent = count(stats.asking) + ' чел.';
  $('scenario-rows').replaceChildren(...series.map(s => {
    const tr=document.createElement('tr');
    [s.q,count(s.asking),count(s.sold),count(s.free)].forEach(t => { const td=document.createElement('td'); td.textContent=t; tr.append(td); });
    return tr;
  }));
  makeChart(series,stats.seats);
  showStatus(`Данные загружены: ${forecasts.length} рейсов, ${new Set(forecasts.map(r=>r.route)).size} маршрутов. Расчёт выполнен.`, 'ok');
}
function makeChart(series,seats) {
  const W=900,H=330,left=72,right=24,top=25,bottom=51;
  const max = Math.max(seats,...series.map(x=>x.asking),1)*1.12;
  const x = i => left + i*(W-left-right)/8;
  const y = v => top+(H-top-bottom)*(1-v/max);
  const esc = n => Number(n).toFixed(1);
  const poly=series.map((s,i)=>`${esc(x(i))},${esc(y(s.asking))}`).join(' ');
  const shaded = `${esc(x(0))},${esc(y(0))} ${poly} ${esc(x(8))},${esc(y(0))}`;
  const lines=[];
  for(let i=0;i<=4;i++) {
    const val=max*i/4;
    lines.push(`<line x1="${left}" y1="${esc(y(val))}" x2="${W-right}" y2="${esc(y(val))}" stroke="#e5edf6"/><text x="${left-15}" y="${esc(y(val)+4)}" text-anchor="end" fill="#75859a" font-size="12">${Math.round(val)}</text>`);
  }
  for(let i=0;i<9;i++) lines.push(`<text x="${esc(x(i))}" y="${H-20}" text-anchor="middle" font-size="12" fill="#77879d">${QUANTILES[i]}</text>`);
  const circles=series.map((s,i)=>`<circle cx="${esc(x(i))}" cy="${esc(y(s.asking))}" r="${i===4?6:4}" fill="${i===4?'#0d55ba':'#1d7ce4'}" stroke="white" stroke-width="2"/>`).join('');
  const svg=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Спрос по квантилям и число мест" role="img"><title>Прогноз спроса: девять квантилей и ограничение по местам</title>${lines.join('')}<polygon points="${shaded}" fill="#e7f1ff" opacity=".7"/><polyline points="${poly}" fill="none" stroke="#1c6cdd" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="${left}" y1="${esc(y(seats))}" x2="${W-right}" y2="${esc(y(seats))}" stroke="#f28a46" stroke-width="2.5" stroke-dasharray="9 6"/><text x="${W-right-3}" y="${esc(y(seats)-9)}" text-anchor="end" fill="#d67e42" font-size="12" font-weight="700">${count(seats)} мест</text>${circles}<text x="${W/2}" y="${H-3}" text-anchor="middle" fill="#75859a" font-size="11">Квантиль прогноза спроса</text></svg>`;
  $('chart').innerHTML = svg;
}
async function loadFile(id,file) {
  if(!file) return;
  const text=await file.text();
  const parsed=parseCSV(text);
  filesState[id]=parsed;
  $(id==='forecast'?'forecast-name':'routes-name').textContent = `${file.name} · ${parsed.length} строк`;
  if(filesState.forecast && filesState.routes) {
    validateData(filesState.forecast,filesState.routes);
    forecasts=filesState.forecast; routes=filesState.routes;
    setEnabled(true);refreshRoutes();
  } else showStatus(`Файл ${file.name} загружен. Выбери второй CSV.`);
}
$('forecast-file').addEventListener('change', async e => {
  try{await loadFile('forecast',e.target.files[0]);}catch(err){showStatus(err.message,'error');}
});
$('routes-file').addEventListener('change', async e => {
  try{await loadFile('routes',e.target.files[0]);}catch(err){showStatus(err.message,'error');}
});
$('departure').addEventListener('change',()=>refreshDestinations());
$('destination').addEventListener('change',refreshDates);
$('flight-date').addEventListener('change',()=>refreshPrice(true));
$('ticket-price').addEventListener('input',()=>{$('price-range').value=$('ticket-price').value;recalculate();});
$('price-range').addEventListener('input',()=>{$('ticket-price').value=$('price-range').value;recalculate();});
$('base-price-btn').addEventListener('click',()=>{$('ticket-price').value=$('base-price-btn').dataset.price;$('price-range').value=$('ticket-price').value;recalculate();});
$('optimal-btn').addEventListener('click',()=>{$('ticket-price').value=$('optimal-btn').dataset.price;$('price-range').value=$('ticket-price').value;recalculate();});
$('flight-form').addEventListener('submit',e=>e.preventDefault());

if(location.protocol!=='file:') {
  Promise.all(['my_forecast.csv','routes.csv'].map(async filename => {
    const r=await fetch('./'+filename);if(!r.ok)throw new Error(filename+' не найден');return r.text();
  })).then(([forecastCsv,routesCsv])=>{
    filesState.forecast=parseCSV(forecastCsv);filesState.routes=parseCSV(routesCsv);
    validateData(filesState.forecast,filesState.routes);
    forecasts=filesState.forecast;routes=filesState.routes;
    $('forecast-name').textContent='my_forecast.csv · автоматически';
    $('routes-name').textContent='routes.csv · автоматически';
    setEnabled(true);refreshRoutes();
  }).catch(()=>{});
}
