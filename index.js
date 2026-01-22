const express = require('express');
const path = require('path');
const { TARGETS, API_KEY, BANKROLL, KELLY_FRACTION } = require('./config/settings');
const { UPSTREAM_MAP } = require('./config/upstream'); 
const { writeLog, getRemainingData } = require('./utils/helpers');
const { calculateBenchmarkProb, getSniperSignal, parseTAFForMax, calculateEdge, calculateStake } = require('./core/logic');
const { fetchMetar, fetchTaf, fetchForecast, fetchDailyHistory, fetchConsensus } = require('./services/weather');
const { fetchDynamicPrice, getDynamicSlug } = require('./services/polymarket');
const { fetchRadar } = require('./services/radar'); 
const { playSound } = require('./services/audio');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); 

let isRunning = false;
let latestResults = []; 
let trackedCities = []; 
let history = {};
let arrowCache = {};
let hourlyForecasts = {}; 
let consensusData = {}; 
let dailyHighs = {};    
let rollingHighs = {};  
let tafData = {}; 
let dailyEventLog = {}; 

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- GATEKEEPER TEMPORAL (Clasificación EARLY / LATE) ---
function checkTradingWindow(target, remainingMs, localHour, peakHour, isPastPeak) {
    const style = target.tradeStyle || "AUTO";
    const policy = target.peakPolicy || {};
    const remainingHours = remainingMs / 3600000;
    
    // Si no tenemos hora pico, asumimos las 15:00 como estándar
    const safePeak = peakHour !== null ? peakHour : 15;
    const hoursToPeak = safePeak - localHour; // Positivo = falta para el pico, Negativo = ya pasó

    // 1. LÓGICA EARLY (Mercados estables/continentales)
    if (style === "EARLY") {
        const deadZone = policy.deadZone || 6;
        if (remainingHours <= deadZone) {
            return { allowed: false, reason: "💤 MKT DEAD (EARLY)" };
        }
        return { allowed: true, reason: "" };
    }

    // 2. LÓGICA LATE (Mercados volátiles/marítimos)
    if (style === "LATE") {
        const window = policy.window || 6;
        const stopPost = policy.stopPostPeak || 2; 

        if (remainingHours > window) {
            return { allowed: false, reason: "⏳ TOO EARLY" };
        }
        
        // Si ya pasó el pico de calor hace mucho, bloqueamos entrada
        if (isPastPeak && Math.abs(hoursToPeak) > stopPost) {
            return { allowed: false, reason: "📉 PAST PEAK" };
        }
        
        return { allowed: true, reason: "" };
    }

    // 3. LÓGICA AUTO (Híbridos)
    if (style === "AUTO") {
        if (remainingHours <= (policy.deadZone || 2)) {
            return { allowed: false, reason: "💤 MKT DEAD" };
        }
        return { allowed: true, reason: "" };
    }

    return { allowed: true, reason: "" };
}

app.post('/api/track', (req, res) => {
    const { id } = req.body;
    if (trackedCities.includes(id)) {
        trackedCities = trackedCities.filter(c => c !== id);
        console.log(`[TRACK] Dejando de vigilar: ${id}`);
    } else {
        trackedCities.push(id);
        console.log(`[TRACK] Vigilando posición en: ${id}`);
    }
    res.json({ trackedCities });
});

app.get('/api/tracked', (req, res) => res.json(trackedCities));

function getWeatherIcon(phrase) {
    if (!phrase) return "";
    const p = phrase.toLowerCase();
    if (p.includes("snow") || p.includes("ice") || p.includes("blizzard")) return "❄️";
    if (p.includes("rain") || p.includes("drizzle") || p.includes("shower") || p.includes("storm")) return "🌧️";
    if (p.includes("cloud") || p.includes("overcast") || p.includes("fog")) return "☁️";
    if (p.includes("sun") || p.includes("clear") || p.includes("fair")) return "☀️";
    return "";
}

function getCardinalDirection(deg) {
    if (deg === null || deg === undefined || deg === "VRB") return null;
    const d = parseFloat(deg);
    if (isNaN(d)) return null;
    if (d >= 315 || d < 45) return "N";
    if (d >= 45 && d < 135) return "E";
    if (d >= 135 && d < 225) return "S";
    if (d >= 225 && d < 315) return "W";
    return null;
}

async function auditAllDailyHighs() {
    console.log(`\n\x1b[36m[AUDITORÍA] Analizando historial (Calendario vs Inercia 24h)...\x1b[0m`);
    for (const t of TARGETS) {
        try {
            const data = await fetchDailyHistory(t.icao, t.tz);
            if (data && data.length > 0) {
                const cityDay = new Date().toLocaleString("en-US", {timeZone: t.tz, day: 'numeric'});
                let maxCalendar = -999; 
                let maxRolling = -999;  
                data.forEach(r => {
                    if (r.temp > maxRolling) maxRolling = r.temp;
                    const reportDay = new Date(r.reportTime).toLocaleString("en-US", {timeZone: t.tz, day: 'numeric'});
                    if (reportDay === cityDay) if (r.temp > maxCalendar) maxCalendar = r.temp;
                });
                if (maxRolling > -999) rollingHighs[t.id] = maxRolling;
                if (maxCalendar > -999) dailyHighs[t.id] = maxCalendar;
                else dailyHighs[t.id] = null; 
            }
        } catch (err) { console.log(`❌ Error auditando ${t.id}:`, err.message); }
    }
}

function getCurrentBenchmark(target) {
    if (!hourlyForecasts[target.id] || hourlyForecasts[target.id].length === 0) return null;
    const nowEpoch = Date.now();
    let closestForecast = null;
    let minDiff = Infinity;
    hourlyForecasts[target.id].forEach(f => {
        const forecastEpoch = new Date(f.fcst_valid_local).getTime();
        const diff = Math.abs(nowEpoch - forecastEpoch);
        if (diff < minDiff) { minDiff = diff; closestForecast = f; }
    });
    if (minDiff > 7200000) return null; 
    return closestForecast ? closestForecast.temp : null;
}

async function updateAllForecasts() {
    for (const t of TARGETS) {
        const data = await fetchForecast(t.locId, API_KEY);
        if (data) hourlyForecasts[t.id] = data;
    }
}

async function updateAllTAFs() {
    for (const t of TARGETS) {
        const data = await fetchTaf(t.icao);
        if (data && data.length > 0) {
            tafData[t.id] = { raw: data[0].rawTAF, max: parseTAFForMax(data[0].rawTAF) };
        }
    }
}

async function checkTarget(target) {
    try {
        const data = await fetchMetar(target.icao);
        if (!data || !data[0]) {
            console.log(`⚠️ SKIP ${target.id}: No llegó data METAR`); 
            return null;
        }
        
        const d = data[0];
        const prevD = data[1];
        const curC = d.temp;
        const dewC = d.dewp; 

        // --- 1. RADAR & CONSENSO (INCERTIDUMBRE) ---
        let radarStatus = { incoming: false, amount: 0 };
        let ensembleSpread = 0; 
        
        if (d.lat && d.long) {
             radarStatus = await fetchRadar(d.lat, d.long) || { incoming: false };
             if (!consensusData[target.id] || (Date.now() - consensusData[target.id].ts > 3600000)) {
                 const con = await fetchConsensus(d.lat, d.long);
                 if (con) {
                     consensusData[target.id] = { val: con, ts: Date.now() };
                     const models = [con.details.gfs, con.details.ecmwf, con.details.icon];
                     const minModel = Math.min(...models);
                     const maxModel = Math.max(...models);
                     ensembleSpread = maxModel - minModel;
                 }
             }
        }

        // --- 2. ADVECCIÓN (VIENTO) ---
        let advectionBonus = 0;
        if (d.wdir !== "VRB") {
            const card = getCardinalDirection(d.wdir);
            if (card && UPSTREAM_MAP[target.icao] && UPSTREAM_MAP[target.icao][card]) {
                const upstreamICAO = UPSTREAM_MAP[target.icao][card];
                const upData = await fetchMetar(upstreamICAO);
                if (upData && upData[0]) {
                    const diff = upData[0].temp - curC;
                    if (diff >= 1.2) advectionBonus = 12; 
                    else if (diff <= -1.2) advectionBonus = -15; 
                }
            }
        }

        // --- 3. TARGET HÍBRIDO ---
        let maxTarget = -999;
        let isCalibrating = true;
        
        if (hourlyForecasts[target.id] && hourlyForecasts[target.id].length > 0) {
            const ibmMax = Math.max(...hourlyForecasts[target.id].map(f => f.temp));
            if (consensusData[target.id]) {
                maxTarget = (ibmMax + consensusData[target.id].val.avg) / 2; 
            } else {
                maxTarget = ibmMax;
            }
            isCalibrating = false;
        }

        const benchmarkC = getCurrentBenchmark(target); 
        let biasBonus = 0;
        if (benchmarkC !== null) {
            const currentBias = curC - benchmarkC;
            if (Math.abs(currentBias) >= 0.5) {
                biasBonus = currentBias * 8; 
                biasBonus = Math.min(25, Math.max(-25, biasBonus));
            }
        }

        let spreadBonus = 0;
        if (curC !== undefined && dewC !== undefined) {
            const spread = curC - dewC;
            if (spread < 3) spreadBonus = -15; 
            else if (spread > 10) spreadBonus = 10; 
        }

        const searchTemp = isCalibrating ? curC : maxTarget;
        let tempForPoly = searchTemp;
        let highForPoly = (dailyHighs[target.id] !== undefined && dailyHighs[target.id] !== null) ? dailyHighs[target.id] : curC;
        
        if (target.unit === 'F') {
            tempForPoly = (searchTemp * 9/5) + 32;
            highForPoly = (highForPoly * 9/5) + 32;
        }

        // --- HORA PICO ---
        let peakTimeStr = "";
        let isPastPeak = false;
        let peakConditionIcon = ""; 
        let isSnowForecast = false;
        let isSunForecast = false;
        let isPrecipitationForecasted = false;
        let peakHour = null;

        if (hourlyForecasts[target.id] && hourlyForecasts[target.id].length > 0) {
            const forecasts = hourlyForecasts[target.id];
            const maxFcst = forecasts.reduce((prev, current) => (prev.temp > current.temp) ? prev : current);
            if (maxFcst) {
                const pDate = new Date(maxFcst.fcst_valid_local);
                peakHour = pDate.getHours();
                peakTimeStr = `${peakHour}:00`;
                
                const localDate = new Date(new Date().toLocaleString("en-US", {timeZone: target.tz}));
                const localHour = localDate.getHours();
                if (localHour > peakHour) isPastPeak = true;
                
                const phrase = maxFcst.phrase_32char || maxFcst.wx_phrase || "";
                peakConditionIcon = getWeatherIcon(phrase);
                if (peakConditionIcon === "❄️") isSnowForecast = true;
                if (peakConditionIcon === "☀️") isSunForecast = true;
                if (peakConditionIcon === "❄️" || peakConditionIcon === "🌧️") isPrecipitationForecasted = true;
            }
        }

        let polyPrice = null;
        let strategyUsed = "PRED"; 
        let marketTitle = "--"; 
        let cleanSlug = typeof getDynamicSlug === 'function' ? getDynamicSlug(target.polySlug, target.tz) : target.polySlug;
        let bucketMax = null;

        try {
            if (typeof fetchDynamicPrice === 'function') {
                const marketData = await fetchDynamicPrice(target.polySlug, target.tz, tempForPoly, highForPoly);
                if (marketData && marketData.primary !== null) {
                    polyPrice = marketData.primary;
                    strategyUsed = marketData.strategy || "PRED";
                    bucketMax = marketData.max;
                    if (marketData.title) marketTitle = marketData.title.replace(/°[CF]/g, "").trim();
                }
            }
        } catch (polyError) {}

        const isRaining = /(RA|DZ|TS|GR|PL)/.test(d.wxString || "");
        if (!arrowCache[target.id]) {
            if (prevD) {
                if (curC > prevD.temp) arrowCache[target.id] = "↑";
                else if (curC < prevD.temp) arrowCache[target.id] = "↓";
                else arrowCache[target.id] = "→";
            } else arrowCache[target.id] = "→";
        }
        let trendArrow = arrowCache[target.id] || "→";

        let tafMaxVal = null;
        let tafConfirmed = false;
        if (tafData[target.id]) {
            tafMaxVal = tafData[target.id].max;
            if (tafMaxVal !== null && tafMaxVal >= maxTarget) tafConfirmed = true;
        }

        // --- CÁLCULO DE PROBABILIDAD ---
        let reachChance = 0;
        let breakChance = 0;
        const rollingMax = rollingHighs[target.id] || curC;
        const highSoFar = (dailyHighs[target.id] !== undefined && dailyHighs[target.id] !== null) ? Math.max(dailyHighs[target.id], curC) : curC;

        if (!isCalibrating) {
            reachChance = calculateBenchmarkProb(curC, maxTarget, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining, rollingMax, highSoFar);
            breakChance = calculateBenchmarkProb(curC, maxTarget + 0.5, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining, rollingMax, highSoFar);
            reachChance += advectionBonus; 
            reachChance += biasBonus;      
            reachChance += spreadBonus;    
            if (ensembleSpread > 2.0) reachChance -= 10; 
            reachChance = Math.min(100, Math.max(0, reachChance));
        }

        // --- BANKING LOGIC ---
        let signalRaw = "";
        
        if (strategyUsed === "BANKING" && polyPrice && polyPrice < 0.90) {
            const distToCeiling = bucketMax ? (bucketMax - highForPoly) : 99;
            let dangerZone = (distToCeiling < 1.0 && (trendArrow === "↑" || trendArrow === "↗"));
            if (biasBonus > 10) dangerZone = true;
            if (advectionBonus > 0) dangerZone = true;
            if (spreadBonus > 0) dangerZone = true; 
            if (isSnowForecast && distToCeiling > 0.3) dangerZone = false; 
            if (spreadBonus < 0 && distToCeiling > 0.5) dangerZone = false;
            if (isSunForecast && distToCeiling < 1.5 && (trendArrow === "↑" || trendArrow === "↗")) dangerZone = true;

            const timeRisk = !isPastPeak;
            const radarBonus = radarStatus.incoming;

            if ((!dangerZone && !timeRisk) || radarBonus) {
                reachChance = 99; 
            } else {
                strategyUsed = "PRED"; 
                if (timeRisk && distToCeiling < 3.0) { reachChance = 45; signalRaw = "⚠️ WAIT PEAK"; } 
                else if (dangerZone) { reachChance = 0; signalRaw = "⛔ CEILING RISK"; }
            }
        }

        const devValue = benchmarkC !== null ? (curC - benchmarkC) : null;
        const isUserTracking = trackedCities.includes(target.id);
        let exitAlert = false;
        let exitReason = "";

        if (isUserTracking) {
            if (radarStatus.incoming && !isPrecipitationForecasted) { exitAlert = true; exitReason = "RAIN - EXIT!"; }
            if (reachChance < 35 && !isCalibrating) { exitAlert = true; exitReason = "LOW PROB - EXIT!"; }
            if (advectionBonus < -10) { exitAlert = true; exitReason = "COLD FRONT - EXIT!"; }
            if (spreadBonus < -10 && strategyUsed !== "BANKING") { exitAlert = true; exitReason = "HUMIDITY - STUCK!"; }

            if (exitAlert) {
                playSound('BLOOD'); 
                console.log(`⚠️ [EXIT ALERT] ${target.id}: ${exitReason}`);
                signalRaw = `🚨 ${exitReason}`;
            }
        }

        if (!signalRaw || (!signalRaw.includes("WAIT") && !signalRaw.includes("RISK") && !exitAlert)) {
             signalRaw = getSniperSignal(reachChance, breakChance, devValue, trendArrow, isCalibrating, tafConfirmed, isRaining);
        }

        // INTERVENCIÓN DEL RADAR
        if (!exitAlert && radarStatus.incoming && strategyUsed !== "BANKING") {
            if (!isPrecipitationForecasted) { reachChance = 0; signalRaw = "🌧️ RADAR ALERT"; playSound('BLOOD'); }
        }
        
        // Edge Calc
        let edgeValue = 0;
        if (polyPrice > 0) {
            const myProb = reachChance / 100;
            edgeValue = myProb - polyPrice;
        }

        if (!exitAlert && strategyUsed === "BANKING" && reachChance > 90) {
            if (polyPrice < 0.85) signalRaw = `💰 BANK HIGH (${highForPoly.toFixed(0)})`;
            else signalRaw = "⛔ PRICED OUT";
        }
        
        let signalText = signalRaw.replace(/\x1b\[[0-9;]*m/g, "");
        let stake = calculateStake(reachChance, polyPrice, BANKROLL, KELLY_FRACTION);
        
        // --- FILTROS DE SEGURIDAD Y CALIDAD (V93) ---
        
        // 1. Filtro de Edge (Calidad)
        if (strategyUsed !== "BANKING" && edgeValue < 0.10 && !signalText.includes("BANK")) {
             if (!isUserTracking) {
                 stake = "0.00";
                 if (!signalText.includes("WAIT") && !signalText.includes("RISK")) {
                     signalText = `📉 NO EDGE (${(edgeValue*100).toFixed(0)}%)`;
                 }
             }
        }

        // 2. Filtro Temporal (Gatekeeper EARLY/LATE)
        const localTimeObj = new Date(new Date().toLocaleString("en-US", {timeZone: target.tz}));
        const localHour = localTimeObj.getHours();
        const remaining = getRemainingData(target.tz);
        
        const gate = checkTradingWindow(target, remaining.ms, localHour, peakHour, isPastPeak);
        
        if (!gate.allowed && !isUserTracking) {
            stake = "0.00";
            if (!signalText.includes("RAIN")) {
                signalText = `⛔ ${gate.reason}`;
            }
        }

        // 3. Parche final de seguridad
        if (signalText.includes("NO TRADE") || 
            signalText.includes("WAIT") || 
            signalText.includes("RISK") || 
            signalText.includes("PRICED OUT") ||
            signalText.includes("NO EDGE") ||
            signalText.includes("MKT DEAD") ||
            signalText.includes("TOO EARLY") ||
            signalText.includes("PAST PEAK") ||
            signalText.includes("RAIN")) {
            stake = "0.00";
        }

        // LOGGING
        if (!isCalibrating && !signalText.includes("RAIN")) {
            const currentDay = new Date().toLocaleString("en-US", {timeZone: target.tz, day: 'numeric'});
            if (!dailyEventLog[target.id] || dailyEventLog[target.id].date !== currentDay) {
                dailyEventLog[target.id] = { date: currentDay, reachLogged: false, breakLogged: false, predLogged: false };
            }
            const logState = dailyEventLog[target.id];

            if (signalText.includes("BANK") && !logState.reachLogged && stake !== "0.00") {
                 playSound('CASH'); 
                 writeLog(`BANKING | ${target.id} | High: ${highForPoly} | Stake: $${stake}`);
                 logState.reachLogged = true;
            }
        }
        
        if (history[target.id] !== undefined && curC !== history[target.id]) playSound('VILLAGER');
        history[target.id] = curC;

        let devDisp = "--";
        if (benchmarkC !== null) {
             let diff = curC - benchmarkC; 
             devDisp = (diff > 0 ? "+" : "") + (target.unit === 'F' ? (diff * 1.8).toFixed(1) : diff.toFixed(1)) + "°";
        }

        let targetDisp = (target.unit === 'F' ? (maxTarget * 9/5 + 32).toFixed(1) + "°F" : maxTarget.toFixed(1) + "°C");
        
        // --- DISPLAY VISUAL ---
        targetDisp += ` <span style="margin-left: 5px; font-size:11px; color:${isPastPeak ? '#8b949e' : '#e3b341'}">🕒 ${peakTimeStr} ${peakConditionIcon}</span>`;
        
        // AVISO VISUAL DE ADVECCIÓN TARDÍA (Solo alerta, no afecta stake)
        if (isPastPeak && advectionBonus > 0) {
            targetDisp += ` <span style="font-size:10px; color:#f0a500; font-weight:bold;">🔥WIND?</span>`;
        }
        
        if (radarStatus.incoming) {
            const color = isPrecipitationForecasted ? "#8b949e" : "#58a6ff"; 
            targetDisp += ` <span style="font-size:10px; color:${color}">🌧️ ${isPrecipitationForecasted ? "EXPECTED" : "SURPRISE"}</span>`;
        }

        if (ensembleSpread > 2.0) {
            targetDisp += ` <span style="font-size:10px; color:#ff7b72">⚠️DIVERGENCE</span>`;
        }

        const score = reachChance + (isUserTracking ? 10000 : 0);
        const localTimeStr = localTimeObj.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

        let priceInfo = polyPrice ? `${marketTitle} (${(polyPrice * 100).toFixed(0)}¢)` : "No Mkt";
        if (edgeValue !== 0 && strategyUsed !== "BANKING") {
            const edgeColor = edgeValue >= 0.10 ? "#3fb950" : "#8b949e";
            priceInfo += ` <span style="font-size:10px; color:${edgeColor}">E:${(edgeValue*100).toFixed(0)}%</span>`;
        }

        return {
            id: target.id, unit: target.unit, curC: curC, high: highSoFar,
            target: maxTarget, targetDisp: targetDisp, taf: tafMaxVal,
            dev: devValue, devDisp: devDisp, trend: trendArrow,
            signal: signalText, priceDisp: priceInfo, stake: stake, 
            hedge: "--", fullSlug: cleanSlug, timer: localTimeStr, 
            score: score, isTracking: isUserTracking
        };
    } catch (e) { return null; }
}

async function monitorLoop() {
    if (!isRunning) return;
    
    let currentRoundResults = [...latestResults]; 
    console.log("⏳ Iniciando ronda rápida...");
    
    for (const t of TARGETS) {
        const res = await checkTarget(t);
        if (res) {
            const idx = currentRoundResults.findIndex(r => r.id === t.id);
            if (idx !== -1) currentRoundResults[idx] = res;
            else currentRoundResults.push(res);
            
            currentRoundResults.sort((a, b) => b.score - a.score);
            latestResults = [...currentRoundResults]; 
        }
        await sleep(1000); 
    }
    
    console.log(`✅ Ronda finalizada.`);
    if (isRunning) setTimeout(monitorLoop, 1000); 
}

app.post('/api/start', (req, res) => {
    if (!isRunning) { isRunning = true; monitorLoop(); }
    res.sendStatus(200);
});

app.post('/api/stop', (req, res) => {
    isRunning = false;
    res.sendStatus(200);
});

app.get('/api/data', (req, res) => {
    res.json(latestResults);
});

app.listen(PORT, async () => {
    console.log(`\n\x1b[32m[SERVER ONLINE]\x1b[0m http://localhost:${PORT}`);
    await updateAllForecasts();
    await updateAllTAFs();
    await auditAllDailyHighs(); 
});
