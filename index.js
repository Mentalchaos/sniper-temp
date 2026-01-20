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

// --- RUTAS DE TRACKING ---
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

app.get('/api/tracked', (req, res) => {
    res.json(trackedCities);
});

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
                let countToday = 0;

                data.forEach(r => {
                    if (r.temp > maxRolling) maxRolling = r.temp;
                    const reportDay = new Date(r.reportTime).toLocaleString("en-US", {timeZone: t.tz, day: 'numeric'});
                    if (reportDay === cityDay) {
                        countToday++;
                        if (r.temp > maxCalendar) maxCalendar = r.temp;
                    }
                });

                if (maxRolling > -999) rollingHighs[t.id] = maxRolling;
                if (maxCalendar > -999) {
                    dailyHighs[t.id] = maxCalendar;
                    console.log(`✅ ${t.id}: Hoy ${maxCalendar}°C | Inercia 24h: ${maxRolling}°C`);
                } else {
                    dailyHighs[t.id] = null; 
                }
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
  console.log(`🔄 Procesando ${target.id}...`); // <--- AGREGA ESTO
    try {
        const data = await fetchMetar(target.icao);
        if (!data || !data[0]) {
          console.log(`⚠️ Falló METAR para ${target.id}`); // <--- AGREGA ESTO
          return null;
        }
        
        const d = data[0];
        const prevD = data[1];
        const curC = d.temp;
        const dewC = d.dewp; 

        // --- 1. RADAR & CONSENSO ---
        let radarStatus = { incoming: false, amount: 0 };
        if (d.lat && d.long) {
             radarStatus = await fetchRadar(d.lat, d.long) || { incoming: false };
             if (!consensusData[target.id] || (Date.now() - consensusData[target.id].ts > 3600000)) {
                 const con = await fetchConsensus(d.lat, d.long);
                 if (con) consensusData[target.id] = { val: con, ts: Date.now() };
             }
        }

        // --- 2. ADVECCIÓN TÉRMICA (UPSTREAM) ---
        let advectionBonus = 0;
        
        if (d.wdir !== "VRB") {
            const card = getCardinalDirection(d.wdir);
            if (card && UPSTREAM_MAP[target.icao] && UPSTREAM_MAP[target.icao][card]) {
                const upstreamICAO = UPSTREAM_MAP[target.icao][card];
                const upData = await fetchMetar(upstreamICAO);
                if (upData && upData[0]) {
                    const upTemp = upData[0].temp;
                    const diff = upTemp - curC;
                    if (diff >= 1.2) {
                        advectionBonus = 12; 
                    } 
                    else if (diff <= -1.2) {
                        advectionBonus = -15; 
                    }
                }
            }
        }

        // --- 3. TARGET HÍBRIDO ---
        let maxTarget = -999;
        let isCalibrating = true;
        if (hourlyForecasts[target.id] && hourlyForecasts[target.id].length > 0) {
            const ibmMax = Math.max(...hourlyForecasts[target.id].map(f => f.temp));
            if (consensusData[target.id]) {
                const conMax = consensusData[target.id].val.avg;
                maxTarget = (ibmMax + conMax) / 2; 
            } else {
                maxTarget = ibmMax;
            }
            isCalibrating = false;
        }

        // --- 4. CÁLCULO DE SESGO (BIAS) ---
        const benchmarkC = getCurrentBenchmark(target); 
        let biasBonus = 0;

        if (benchmarkC !== null) {
            const currentBias = curC - benchmarkC;
            if (Math.abs(currentBias) >= 0.5) {
                biasBonus = currentBias * 8; 
                biasBonus = Math.min(25, Math.max(-25, biasBonus));
            }
        }

        // --- 5. VOLATILIDAD (DEW POINT SPREAD) ---
        let spreadBonus = 0;
        if (curC !== undefined && dewC !== undefined) {
            const spread = curC - dewC;
            if (spread < 3) {
                spreadBonus = -15; // Húmedo/Pegajoso
            } 
            else if (spread > 10) {
                spreadBonus = 10; // Seco/Volátil
            }
        }

        const searchTemp = isCalibrating ? curC : maxTarget;
        let tempForPoly = searchTemp;
        let highForPoly = (dailyHighs[target.id] !== undefined && dailyHighs[target.id] !== null) ? dailyHighs[target.id] : curC;
        
        if (target.unit === 'F') {
            tempForPoly = (searchTemp * 9/5) + 32;
            highForPoly = (highForPoly * 9/5) + 32;
        }

        // --- HORA PICO + CONDICIONES ---
        let peakTimeStr = "";
        let isPastPeak = false;
        let peakConditionIcon = ""; 
        let isSnowForecast = false;
        let isSunForecast = false;
        let isPrecipitationForecasted = false;

        if (hourlyForecasts[target.id] && hourlyForecasts[target.id].length > 0) {
            const forecasts = hourlyForecasts[target.id];
            const maxFcst = forecasts.reduce((prev, current) => (prev.temp > current.temp) ? prev : current);
            
            if (maxFcst) {
                const pDate = new Date(maxFcst.fcst_valid_local);
                const pHour = pDate.getHours();
                peakTimeStr = `${pHour}:00`;
                const localDate = new Date(new Date().toLocaleString("en-US", {timeZone: target.tz}));
                const localHour = localDate.getHours();
                if (localHour > pHour) isPastPeak = true;

                const phrase = maxFcst.phrase_32char || maxFcst.wx_phrase || "";
                peakConditionIcon = getWeatherIcon(phrase);
                
                if (peakConditionIcon === "❄️") isSnowForecast = true;
                if (peakConditionIcon === "☀️") isSunForecast = true;
                if (peakConditionIcon === "❄️" || peakConditionIcon === "🌧️") isPrecipitationForecasted = true;
            }
        }

        let polyPrice = null;
        let strategyUsed = "PRED"; 
        let hedgeInfo = [];
        let bucketMin = null; 
        let bucketMax = null;
        let marketTitle = "--"; 
        let cleanSlug = typeof getDynamicSlug === 'function' ? getDynamicSlug(target.polySlug, target.tz) : target.polySlug;

        try {
            if (typeof fetchDynamicPrice === 'function') {
                const marketData = await fetchDynamicPrice(target.polySlug, target.tz, tempForPoly, highForPoly);
                if (marketData && marketData.primary !== null) {
                    polyPrice = marketData.primary;
                    strategyUsed = marketData.strategy || "PRED";
                    bucketMin = marketData.min;
                    bucketMax = marketData.max;
                    if (marketData.title) marketTitle = marketData.title.replace(/°[CF]/g, "").trim();

                    const rawHedges = marketData.hedges || [];
                    const buffer = 3.0; 
                    hedgeInfo = rawHedges.filter(h => h.max >= tempForPoly && h.min <= (tempForPoly + buffer)).slice(0, 2);
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
        if (history[target.id] !== undefined) {
            if (curC > history[target.id]) arrowCache[target.id] = "↑";
            else if (curC < history[target.id]) arrowCache[target.id] = "↓";
        }
        let trendArrow = arrowCache[target.id];

        let tafMaxVal = null;
        let tafConfirmed = false;
        if (tafData[target.id]) {
            tafMaxVal = tafData[target.id].max;
            if (tafMaxVal !== null && tafMaxVal >= maxTarget) tafConfirmed = true;
        }

        let reachChance = 0;
        let breakChance = 0;
        
        const rollingMax = rollingHighs[target.id] || curC;
        const highSoFar = (dailyHighs[target.id] !== undefined && dailyHighs[target.id] !== null) ? Math.max(dailyHighs[target.id], curC) : curC;

        if (!isCalibrating) {
            reachChance = calculateBenchmarkProb(curC, maxTarget, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining, rollingMax, highSoFar);
            breakChance = calculateBenchmarkProb(curC, maxTarget + 0.5, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining, rollingMax, highSoFar);
            
            // --- SUMATORIA DE PROBABILIDADES (INTERNA) ---
            reachChance += advectionBonus; // Advección
            reachChance += biasBonus;      // Sesgo
            reachChance += spreadBonus;    // Volatilidad (Spread)
            
            reachChance = Math.min(100, Math.max(0, reachChance));
        }

        // --- LÓGICA DE BANKING ---
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
                if (timeRisk && distToCeiling < 3.0) {
                     reachChance = 45; 
                     signalRaw = "⚠️ WAIT PEAK"; 
                } 
                else if (dangerZone) {
                    reachChance = 0;
                    signalRaw = "⛔ CEILING RISK";
                }
            }
        }

        const devValue = benchmarkC !== null ? (curC - benchmarkC) : null;
        let signalRaw = "";
        
        // --- 4. ALERTA DE SALIDA ---
        const isUserTracking = trackedCities.includes(target.id);
        let exitAlert = false;
        let exitReason = "";

        if (isUserTracking) {
            if (radarStatus.incoming && !isPrecipitationForecasted) { exitAlert = true; exitReason = "RAIN - EXIT!"; }
            if (reachChance < 35 && !isCalibrating) { exitAlert = true; exitReason = "LOW PROB - EXIT!"; }
            if (advectionBonus < -10) { exitAlert = true; exitReason = "COLD FRONT - EXIT!"; }
            // Si entra humedad de golpe, la volatilidad muere. Salir si buscábamos un Break.
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
            if (!isPrecipitationForecasted) {
                reachChance = 0;
                signalRaw = "🌧️ RADAR ALERT"; 
                playSound('BLOOD'); 
            }
        }
        
        if (!exitAlert && strategyUsed === "BANKING" && reachChance > 90) {
            signalRaw = `💰 BANK HIGH (${highForPoly.toFixed(0)})`;
        }

        let signalText = signalRaw.replace(/\x1b\[[0-9;]*m/g, "");
        const stake = calculateStake(reachChance, polyPrice, BANKROLL, KELLY_FRACTION);
        const edgeVal = calculateEdge(reachChance, polyPrice);

        if (!isCalibrating && !signalText.includes("RAIN")) {
            const currentDay = new Date().toLocaleString("en-US", {timeZone: target.tz, day: 'numeric'});
            if (!dailyEventLog[target.id] || dailyEventLog[target.id].date !== currentDay) {
                dailyEventLog[target.id] = { date: currentDay, reachLogged: false, breakLogged: false, predLogged: false };
            }
            const logState = dailyEventLog[target.id];

            if (signalText.includes("BANK") && !logState.reachLogged) {
                 playSound('CASH'); 
                 writeLog(`BANKING | ${target.id} | High: ${highForPoly} | Stake: $${stake}`);
                 logState.reachLogged = true;
            }
        }
        
        if (history[target.id] !== undefined && curC !== history[target.id]) playSound('VILLAGER');

        history[target.id] = curC;
        history[target.id + '_lastBreak'] = breakChance;
        history[target.id + '_lastReach'] = reachChance;

        let devDisp = "--";
        if (benchmarkC !== null) {
             let diff = curC - benchmarkC; 
             let diffDisplay = target.unit === 'F' ? (diff * 1.8).toFixed(1) : diff.toFixed(1);
             devDisp = (diff > 0 ? "+" : "") + diffDisplay + "°";
        }

        let hedgeStr = "--";
        if (hedgeInfo && hedgeInfo.length > 0) {
            hedgeStr = hedgeInfo.map(h => `${h.title} (${(h.price*100).toFixed(0)}¢)`).join(" / ");
        }

        let targetDisp = (target.unit === 'F' ? (maxTarget * 9/5 + 32).toFixed(1) + "°F" : maxTarget.toFixed(1) + "°C");
        if (peakTimeStr) {
            targetDisp += ` <span style="font-size:11px; color:${isPastPeak ? '#8b949e' : '#e3b341'}">🕒${peakTimeStr} ${peakConditionIcon}</span>`;
        }
        if (radarStatus.incoming) {
            const rainType = isPrecipitationForecasted ? "EXPECTED" : "SURPRISE";
            const color = isPrecipitationForecasted ? "#8b949e" : "#58a6ff"; 
            targetDisp += ` <span style="font-size:10px; color:${color}">🌧️ ${rainType}</span>`;
        }
        
        // --- MODO STEALTH: No mostramos los extras, pero están calculados arriba ---
        // (El bloque de visualización de extras ha sido eliminado a petición del usuario)

        return {
            id: target.id,
            unit: target.unit,
            curC: curC,
            high: highSoFar,
            target: maxTarget,
            targetDisp: targetDisp,
            taf: tafMaxVal,
            dev: devValue,
            devDisp: devDisp,
            trend: trendArrow,
            signal: signalText,
            priceDisp: polyPrice ? `${marketTitle} (${(polyPrice * 100).toFixed(0)}¢)` : "No Mkt",
            stake: stake, 
            hedge: hedgeStr,
            fullSlug: cleanSlug,
            timer: getRemainingData(target.tz).str,
            score: finalScore + (isUserTracking ? 10000 : 0),
            isTracking: isUserTracking
        };

    } catch (e) { 
        return null; 
    }
}

async function monitorLoop() {
    if (!isRunning) return;
    const results = await Promise.all(TARGETS.map(t => checkTarget(t)));
    const validResults = results.filter(r => r !== null);
    validResults.sort((a, b) => b.score - a.score);
    latestResults = validResults;
    if (isRunning) setTimeout(monitorLoop, 3000);
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
    setInterval(updateAllForecasts, 1800000); 
    setInterval(auditAllDailyHighs, 300000);  
    setInterval(updateAllTAFs, 600000);       
});

