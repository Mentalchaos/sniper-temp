const express = require('express');
const path = require('path');
const { TARGETS, API_KEY } = require('./config/settings');
const { COLORS, toF, writeLog, getRemainingData } = require('./utils/helpers');
const { calculateBenchmarkProb, getSniperSignal, parseTAFForMax, calculateEdge } = require('./core/logic');
const { fetchMetar, fetchTaf, fetchForecast, fetchDailyHistory } = require('./services/weather');
const { fetchDynamicPrice, getDynamicSlug } = require('./services/polymarket');
const { playSound } = require('./services/audio');

// --- CONFIGURACIÓN DEL SERVIDOR WEB ---
const app = express();
const PORT = 3000;
// Sirve los archivos estáticos (HTML) desde la carpeta 'public'
app.use(express.static('public'));

// --- ESTADO EN MEMORIA ---
let isRunning = false; // Controla si el bot está escaneando o no
let latestResults = []; // Almacena los datos para enviarlos a la web
let history = {};
let arrowCache = {};
let hourlyForecasts = {}; 
let dailyHighs = {}; 
let tafData = {}; 
let dailyEventLog = {}; 

// --- FUNCIONES AUXILIARES ---

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

// --- ACTUALIZACIÓN DE DATOS DE FONDO ---

async function updateAllForecasts() {
    TARGETS.forEach(async t => {
        const data = await fetchForecast(t.locId, API_KEY);
        if (data) hourlyForecasts[t.id] = data;
    });
}

async function updateAllTAFs() {
    TARGETS.forEach(async t => {
        const data = await fetchTaf(t.icao);
        if (data && data.length > 0) {
            tafData[t.id] = {
                raw: data[0].rawTAF,
                max: parseTAFForMax(data[0].rawTAF)
            };
        }
    });
}

async function auditAllDailyHighs() {
    TARGETS.forEach(async t => {
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
    });
}

// --- LÓGICA PRINCIPAL DEL SNIPER ---

async function checkTarget(target) {
    try {
        // 1. Obtener Clima Actual
        const data = await fetchMetar(target.icao);
        if (!data || !data[0]) return null;
        
        const d = data[0];
        const prevD = data[1];
        const curC = d.temp;

        // 2. Determinar Meta (Max Target)
        let maxTarget = -999;
        let isCalibrating = true;
        if (hourlyForecasts[target.id] && hourlyForecasts[target.id].length > 0) {
            maxTarget = Math.max(...hourlyForecasts[target.id].map(f => f.temp));
            isCalibrating = false;
        }

        // 3. Buscar Precio en Polymarket
        const searchTemp = isCalibrating ? curC : maxTarget;
        let tempForPoly = searchTemp;
        if (target.unit === 'F') tempForPoly = (searchTemp * 9/5) + 32;

        const polyPrice = await fetchDynamicPrice(target.polySlug, target.tz, tempForPoly);
        // Generamos el slug completo para el link en la web
        const fullSlug = getDynamicSlug(target.polySlug, target.tz);

        // 4. Lógica de Clima (Lluvia, Viento, Benchmark)
        const wxString = d.wxString || "";
        const isRaining = /(RA|DZ|TS|GR|PL)/.test(wxString);

        const benchmarkC = getCurrentBenchmark(target);

        // Flechas de tendencia
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

        // Análisis TAF
        let tafMaxVal = null;
        let tafConfirmed = false;
        if (tafData[target.id]) {
            tafMaxVal = tafData[target.id].max;
            if (tafMaxVal !== null && tafMaxVal >= maxTarget) tafConfirmed = true;
        }

        // Cálculos de Probabilidad
        let reachChance = 0;
        let breakChance = 0;
        if (!isCalibrating) {
            reachChance = calculateBenchmarkProb(curC, maxTarget, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining);
            breakChance = calculateBenchmarkProb(curC, maxTarget + 0.5, benchmarkC, d.wdir, d.clouds, target.tz, target, trendArrow, tafMaxVal, isRaining);
        }

        const devValue = benchmarkC !== null ? (curC - benchmarkC) : null;
        
        // Obtener señal y limpiarla de códigos de color ANSI (para la web)
        let rawSignal = getSniperSignal(reachChance, breakChance, devValue, trendArrow, isCalibrating, tafConfirmed, isRaining);
        // Regex para quitar los códigos de color de terminal (\x1b...)
        let signalText = rawSignal.replace(/\x1b\[[0-9;]*m/g, "");

        // 5. Alertas de Audio y Logs
        const lastBreakChance = history[target.id + '_lastBreak'] || 0;
        const lastReachChance = history[target.id + '_lastReach'] || 0;
        
        if (!isCalibrating && !signalText.includes("RAIN")) {
            const currentDay = new Date().toLocaleString("en-US", {timeZone: target.tz, day: 'numeric'});
            if (!dailyEventLog[target.id] || dailyEventLog[target.id].date !== currentDay) {
                dailyEventLog[target.id] = { date: currentDay, reachLogged: false, breakLogged: false };
            }
            const logState = dailyEventLog[target.id];

            if (breakChance > lastBreakChance && breakChance >= 95) {
                playSound('BLOOD');
                if (!logState.breakLogged) {
                    writeLog(`BREAK | ${target.id} | Price: ${polyPrice} | Edge: ${calculateEdge(reachChance, polyPrice)}%`);
                    logState.breakLogged = true;
                }
            }
            else if (signalText.includes("PREDICTION") && history[target.id + '_lastPred'] !== true) {
                playSound('BLOOD');
                history[target.id + '_lastPred'] = true;
            }
            else if (signalText.includes("REACH") && reachChance >= 75) {
                if (lastReachChance < 75) playSound('YASUO'); 
                if (!logState.reachLogged) {
                    writeLog(`REACH | ${target.id} | Price: ${polyPrice} | Edge: ${calculateEdge(reachChance, polyPrice)}%`);
                    logState.reachLogged = true;
                }
            }
        }
        
        if (history[target.id] !== undefined && curC !== history[target.id]) {
            playSound('VILLAGER');
        }

        // Actualizar historial
        history[target.id] = curC;
        history[target.id + '_lastBreak'] = breakChance;
        history[target.id + '_lastReach'] = reachChance;

        const highSoFar = dailyHighs[target.id] || curC;
        
        // 6. Preparar datos para el Frontend (Web)
        let edgeValue = null;
        let priceDisp = "No Mkt";
        if (polyPrice !== null) {
            edgeValue = calculateEdge(reachChance, polyPrice);
            priceDisp = `${(polyPrice * 100).toFixed(0)}¢ (Edge: ${edgeValue}%)`;
        }

        // Calcular puntaje para ordenar la tabla
        let sortScore = 0;
        let edgeBonus = (edgeValue !== null && parseFloat(edgeValue) > 0) ? parseFloat(edgeValue) * 10 : 0;
        if (signalText.includes("PREDICTION")) sortScore = 1000 + edgeBonus;
        else if (signalText.includes("SCALP")) sortScore = 900 + breakChance + edgeBonus;
        else if (signalText.includes("REACH")) sortScore = 700 + reachChance + edgeBonus;
        else if (signalText.includes("WAIT")) sortScore = 500;
        else sortScore = 0;

        // Formatear desviación
        let devDisp = "--";
        if (benchmarkC !== null) {
             let diff = curC - benchmarkC; 
             let diffDisplay = target.unit === 'F' ? (diff * 1.8).toFixed(1) : diff.toFixed(1);
             devDisp = (diff > 0 ? "+" : "") + diffDisplay + "°";
        }

        // Retornamos objeto JSON limpio
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
            priceDisp: priceDisp,
            fullSlug: fullSlug,
            timer: getRemainingData(target.tz).str,
            score: sortScore
        };

    } catch (e) { return null; }
}

// --- BUCLE DE MONITOREO ---

async function monitorLoop() {
    if (!isRunning) return; // Si está detenido, no hace nada
    
    const results = await Promise.all(TARGETS.map(t => checkTarget(t)));
    const validResults = results.filter(r => r !== null);
    
    // Ordenar por importancia (Score)
    validResults.sort((a, b) => b.score - a.score);
    
    // Actualizar la variable global que lee la web
    latestResults = validResults; 
    
    // Feedback mínimo en consola para saber que vive
    process.stdout.write(`\r[${new Date().toLocaleTimeString()}] Escaneando ${validResults.length} mercados...`);
    
    // Siguiente ciclo en 5 segundos
    if (isRunning) setTimeout(monitorLoop, 5000);
}

// --- RUTAS DE LA API (Endpoints) ---

// Iniciar el bot desde el botón de la web
app.post('/api/start', (req, res) => {
    if (!isRunning) {
        isRunning = true;
        console.log("\n>>> SISTEMA INICIADO <<<");
        monitorLoop();
    }
    res.sendStatus(200);
});

// Detener el bot desde el botón de la web
app.post('/api/stop', (req, res) => {
    isRunning = false;
    console.log("\n>>> SISTEMA DETENIDO <<<");
    res.sendStatus(200);
});

// La web pide los datos aquí cada 2 segundos
app.get('/api/data', (req, res) => {
    res.json(latestResults);
});

// --- INICIO DEL SERVIDOR ---

app.listen(PORT, () => {
    console.log(`\n\x1b[32m[SERVER ONLINE]\x1b[0m Dashboard activo en: http://localhost:${PORT}`);
    console.log(`Abre tu navegador para controlar el Sniper.`);
    
    // Inicialización de datos meteorológicos
    console.log("Cargando pronósticos iniciales...");
    updateAllForecasts();
    updateAllTAFs();
    auditAllDailyHighs();

    // Tareas programadas de fondo
    setInterval(updateAllForecasts, 1800000); // 30 min
    setInterval(auditAllDailyHighs, 300000);  // 5 min
    setInterval(updateAllTAFs, 600000);       // 10 min
});