const express = require('express');
const path = require('path');
const { TARGETS, API_KEY, BANKROLL, KELLY_FRACTION } = require('./config/settings');
const { writeLog, getRemainingData } = require('./utils/helpers');
const { calculateBenchmarkProb, getSniperSignal, parseTAFForMax, calculateEdge, calculateStake } = require('./core/logic');
const { fetchMetar, fetchTaf, fetchForecast, fetchDailyHistory } = require('./services/weather');
const { fetchDynamicPrice, getDynamicSlug } = require('./services/polymarket');
const { playSound } = require('./services/audio');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

let isRunning = false;
let latestResults = []; 
let history = {};
let arrowCache = {};
let hourlyForecasts = {}; 
let dailyHighs = {}; 
let tafData = {}; 
let dailyEventLog = {}; 

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

async function auditAllDailyHighs() {
    for (const t of TARGETS) {
        const data = await fetchDailyHistory(t.icao, t.tz);
        if (data && data.length > 0) {
            const day = new Date().toLocaleString("en-US", {timeZone: t.tz, day: 'numeric'});
            let max = -999;
            data.forEach(r => {
                if (new Date(r.reportTime).toLocaleString("en-US", {timeZone: t.tz, day: 'numeric'}) === day) {
                    if (r.temp > max) max = r.temp;
                }
            });
            if (max > -999) dailyHighs[t.id] = max;
        }
    }
}


async function checkTarget(target) {
    try {
        const data = await fetchMetar(target.icao);
        if (!data || !data[0]) return null;
        
        const d = data[0];
        const prevD = data[1];
        const curC = d.temp;

        let maxTarget = -999;
        let isCalibrating = true;
        if (hourlyForecasts[target.id] && hourlyForecasts[target.id].length > 0) {
            maxTarget = Math.max(...hourlyForecasts[target.id].map(f => f.temp));
            isCalibrating = false;
        }

        const searchTemp = isCalibrating ? curC : maxTarget;
        let tempForPoly = searchTemp;
        if (target.unit === 'F') tempForPoly = (searchTemp * 9/5) + 32;

        let polyPrice = null;
        let hedgeInfo = [];
        let cleanSlug = typeof getDynamicSlug === 'function' ? getDynamicSlug(target.polySlug, target.tz) : target.polySlug;

        try {
            if (typeof fetchDynamicPrice === 'function') {
                const marketData = await fetchDynamicPrice(target.polySlug, target.tz, tempForPoly);
                
                if (marketData && marketData.primary !== null) {
                    polyPrice = marketData.primary;
                    const rawHedges = marketData.hedges || [];
                    hedgeInfo = rawHedges.filter(h => h.max >= tempForPoly && h.min <= (tempForPoly + 3.0)).slice(0, 2);
                } else if (marketData && marketData.error) {
                    const errorMsgs = {
                        "URL_404_OR_NETWORK": "🌐 URL no encontrada (¿Evento no creado aún?)",
                        "RANGE_NOT_IN_LIST": `🚫 El rango para ${tempForPoly}${target.unit} no existe en la lista.`,
                        "RANGE_PAUSED_OR_REVIEW": "⚠️ Mercado encontrado pero está en REVIEW/PAUSA.",
                        "EVENT_NOT_FOUND": "❌ El evento existe pero no tiene mercados activos."
                    };
                    console.log(`\n\x1b[33m[DEBUG No Mkt - ${target.id}]\x1b[0m ${errorMsgs[marketData.error] || marketData.error}`);
                }
            }
        } catch (polyError) {
            console.error(`\n\x1b[31m[ERROR POLY - ${target.id}]\x1b[0m`, polyError.message);
        }

        // 5. Señales y Clima
        const isRaining = /(RA|DZ|TS|GR|PL)/.test(d.wxString || "");
        const benchmarkC = getCurrentBenchmark(target);

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
        if (!isCalibrating) {
            reachChance = calculateBenchmarkProb(curC, maxTarget, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining);
            breakChance = calculateBenchmarkProb(curC, maxTarget + 0.5, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining);
        }

        const devValue = benchmarkC !== null ? (curC - benchmarkC) : null;
        let signalRaw = getSniperSignal(reachChance, breakChance, devValue, trendArrow, isCalibrating, tafConfirmed, isRaining);
        let signalText = signalRaw.replace(/\x1b\[[0-9;]*m/g, "");

        const stake = calculateStake(reachChance, polyPrice, BANKROLL, KELLY_FRACTION);
        const edgeVal = calculateEdge(reachChance, polyPrice);

        if (!isCalibrating && !signalText.includes("RAIN")) {
            const currentDay = new Date().toLocaleString("en-US", {timeZone: target.tz, day: 'numeric'});
            if (!dailyEventLog[target.id] || dailyEventLog[target.id].date !== currentDay) {
                dailyEventLog[target.id] = { date: currentDay, reachLogged: false, breakLogged: false, predLogged: false };
            }
            const logState = dailyEventLog[target.id];
            const lastBreakChance = history[target.id + '_lastBreak'] || 0;
            const lastReachChance = history[target.id + '_lastReach'] || 0;

            if (breakChance > lastBreakChance && breakChance >= 95) {
                playSound('BLOOD');
                if (!logState.breakLogged) {
                    writeLog(`BLOOD | ${target.id} | Price: ${polyPrice} | Edge: ${edgeVal}% | Stake: $${stake}`);
                    logState.breakLogged = true;
                }
            }
            else if (signalText.includes("PREDICTION") && !logState.predLogged) {
                playSound('BLOOD');
                writeLog(`PRED | ${target.id} | TAF Confirmed: ${tafMaxVal} | Edge: ${edgeVal}%`);
                logState.predLogged = true;
            }
            else if (signalText.includes("REACH") && reachChance >= 75) {
                if (lastReachChance < 75) playSound('YASUO'); 
                if (!logState.reachLogged) {
                    writeLog(`REACH | ${target.id} | Prob: ${reachChance}% | Edge: ${edgeVal}% | Stake: $${stake}`);
                    logState.reachLogged = true;
                }
            }
        }
        
        if (history[target.id] !== undefined && curC !== history[target.id]) playSound('VILLAGER');

        history[target.id] = curC;
        history[target.id + '_lastBreak'] = breakChance;
        history[target.id + '_lastReach'] = reachChance;

        const highSoFar = dailyHighs[target.id] || curC;
        
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

        let baseScore = 0;
        
        if (signalText.includes("PREDICTION")) baseScore = 5000;
        else if (signalText.includes("SCALP")) baseScore = 4000;
        else if (signalText.includes("REACH")) baseScore = 3000;
        else if (signalText.includes("WAIT")) baseScore = 1000;
        else baseScore = 0;

        const edgeBonus = parseFloat(edgeVal) > 0 ? parseFloat(edgeVal) * 50 : 0;
        const finalScore = baseScore + edgeBonus + reachChance;

        return {
            id: target.id,
            unit: target.unit,
            curC: curC,
            high: highSoFar,
            target: maxTarget,
            taf: tafMaxVal,
            dev: devValue,
            devDisp: devDisp,
            trend: trendArrow,
            signal: signalText,
            priceDisp: polyPrice ? `${(polyPrice * 100).toFixed(0)}¢ (Edge: ${edgeVal}%)` : "No Mkt",
            stake: stake, 
            hedge: hedgeStr,
            fullSlug: cleanSlug,
            timer: getRemainingData(target.tz).str,
            score: (parseFloat(edgeVal) > 0 ? parseFloat(edgeVal) * 10 : 0) + reachChance,
            score: finalScore
        };

    } catch (e) { 
        console.error(`[CRITICAL ERROR] Target ${target.id} falló:`, e);
        return null; 
    }
}

async function monitorLoop() {
    if (!isRunning) return;
    const results = await Promise.all(TARGETS.map(t => checkTarget(t)));
    const validResults = results.filter(r => r !== null);
    validResults.sort((a, b) => b.score - a.score);
    latestResults = validResults;
    process.stdout.write(`\r[${new Date().toLocaleTimeString()}] Monitoreando...`);
    if (isRunning) setTimeout(monitorLoop, 5000);
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

app.listen(PORT, () => {
    console.log(`\n\x1b[32m[SERVER ONLINE]\x1b[0m http://localhost:${PORT}`);
    updateAllForecasts();
    updateAllTAFs();
    auditAllDailyHighs();
    setInterval(updateAllForecasts, 1800000); 
    setInterval(auditAllDailyHighs, 300000);  
    setInterval(updateAllTAFs, 600000);       
});
