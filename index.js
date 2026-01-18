const { TARGETS, API_KEY } = require('./config/settings');
const { COLORS, toF, writeLog, getRemainingData } = require('./utils/helpers');
const { calculateBenchmarkProb, getSniperSignal, parseTAFForMax } = require('./core/logic');
const { fetchMetar, fetchTaf, fetchForecast, fetchDailyHistory } = require('./services/weather');
const { playSound } = require('./services/audio');

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

async function checkTarget(target) {
    try {
        const data = await fetchMetar(target.icao);
        if (!data || !data[0]) return null;
        
        const d = data[0];
        const prevD = data[1];
        const curC = d.temp;

        const wxString = d.wxString || "";
        const isRaining = /(RA|DZ|TS|GR|PL)/.test(wxString);
        let weatherDisp = wxString ? `[${COLORS.CYAN}${wxString}${COLORS.RESET}]` : "";
        if (isRaining) weatherDisp = `[${COLORS.BLUE_BG}${wxString || "RAIN"}${COLORS.RESET}]`;

        let maxTarget = -999;
        let isCalibrating = true;
        if (hourlyForecasts[target.id] && hourlyForecasts[target.id].length > 0) {
            maxTarget = Math.max(...hourlyForecasts[target.id].map(f => f.temp));
            isCalibrating = false;
        }

        const benchmarkC = getCurrentBenchmark(target);

        if (!arrowCache[target.id]) {
            if (prevD) {
                if (curC > prevD.temp) arrowCache[target.id] = `${COLORS.GREEN}${COLORS.BOLD}↑${COLORS.RESET}`;
                else if (curC < prevD.temp) arrowCache[target.id] = `${COLORS.RED}${COLORS.BOLD}↓${COLORS.RESET}`;
                else arrowCache[target.id] = `${COLORS.YELLOW}→${COLORS.RESET}`;
            } else { arrowCache[target.id] = `${COLORS.YELLOW}→${COLORS.RESET}`; }
        }
        if (history[target.id] !== undefined) {
            if (curC > history[target.id]) arrowCache[target.id] = `${COLORS.GREEN}${COLORS.BOLD}↑${COLORS.RESET}`;
            else if (curC < history[target.id]) arrowCache[target.id] = `${COLORS.RED}${COLORS.BOLD}↓${COLORS.RESET}`;
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
        const signal = getSniperSignal(reachChance, breakChance, devValue, trendArrow, isCalibrating, tafConfirmed, isRaining);

        let sortScore = 0;
        if (signal.includes("PREDICTION")) sortScore = 1000;
        else if (signal.includes("SCALP")) sortScore = 900 + breakChance;
        else if (signal.includes("BUY REACH")) sortScore = 700 + reachChance;
        else if (signal.includes("WAIT")) sortScore = 500;
        else if (signal.includes("CALIBRATING")) sortScore = 400;
        else if (signal.includes("NO TRADE")) sortScore = 100;
        else sortScore = 0; 

        const lastBreakChance = history[target.id + '_lastBreak'] || 0;
        const lastReachChance = history[target.id + '_lastReach'] || 0;
        
        if (!isCalibrating && !signal.includes("RAIN KILL")) {
            const currentDay = new Date().toLocaleString("en-US", {timeZone: target.tz, day: 'numeric'});
            if (!dailyEventLog[target.id] || dailyEventLog[target.id].date !== currentDay) {
                dailyEventLog[target.id] = { date: currentDay, reachLogged: false, breakLogged: false };
            }
            const logState = dailyEventLog[target.id];

            if (breakChance > lastBreakChance && breakChance >= 95) {
                playSound('BLOOD');
                if (!logState.breakLogged) {
                    writeLog(`REGISTRO: ${currentDay} | ${target.id} | TIPO: BREAK | Prob: ${breakChance}% | Temp: ${curC}°C`);
                    logState.breakLogged = true;
                }
            }
            else if (signal.includes("PREDICTION BREAK") && history[target.id + '_lastPred'] !== true) {
                playSound('BLOOD');
                history[target.id + '_lastPred'] = true;
            }
            else if (signal.includes("BUY REACH") && reachChance >= 75) {
                if (lastReachChance < 75) playSound('YASUO'); 
                if (!logState.reachLogged) {
                    writeLog(`REGISTRO: ${currentDay} | ${target.id} | TIPO: REACH | Prob: ${reachChance}% | Temp: ${curC}°C`);
                    logState.reachLogged = true;
                }
            }
        }
        
        if (history[target.id] !== undefined && curC !== history[target.id]) {
            playSound('VILLAGER');
        }

        history[target.id] = curC;
        history[target.id + '_lastBreak'] = breakChance;
        history[target.id + '_lastReach'] = reachChance;

        const highSoFar = dailyHighs[target.id] || curC;
        let highDisp = highSoFar > curC ? `${COLORS.MAGENTA}(Max:${highSoFar}C/${toF(highSoFar)}F)${COLORS.RESET}` : "";
        const timerStr = getRemainingData(target.tz).str;
        let deviationDisp = `[${COLORS.CYAN}Dev:--${COLORS.RESET}]`; 
        if (benchmarkC !== null) {
            const diff = curC - benchmarkC;
            const color = diff >= 0 ? COLORS.GREEN : COLORS.RED;
            deviationDisp = `[${color}Dev:${diff > 0 ? "+" : ""}${diff.toFixed(1)}°${COLORS.RESET}]`;
        }
        const maxTgtStr = isCalibrating ? `${COLORS.CYAN}LOADING...${COLORS.RESET}` : `${COLORS.ORANGE}Max: ${maxTarget}°C${COLORS.RESET}`;
        let tafDisp = tafMaxVal !== null ? `| ${COLORS.PURPLE_BOLD}TAF:${tafMaxVal}°C${COLORS.RESET}` : "";

        return {
            line: `● ${target.id.padEnd(14)} | ${timerStr} | Act: ${curC}°C/${toF(curC)}F ${weatherDisp} ${deviationDisp} ${trendArrow} ${highDisp} | ${signal} | ${maxTgtStr} ${tafDisp}`,
            score: sortScore
        };

    } catch (e) { return { line: `[!] ${target.id}: ERR ${e.message}`, score: -1 }; }
}

async function monitor() {
    const results = await Promise.all(TARGETS.map(t => checkTarget(t)));
    
    const validResults = results.filter(r => r !== null);
    validResults.sort((a, b) => b.score - a.score);

    let out = `\x1b[H\x1b[J${COLORS.YELLOW}=== SNIPER V50: CLEAN CORE ===${COLORS.RESET}\n`;
    out += `Log activo: logs/sniper_blackbox.txt\n`;
    out += `-------------------------------------------------------------------------------------------------------------------\n`;
    
    validResults.forEach(r => {
        out += r.line + "\n";
    });

    process.stdout.write(out);
    
    setTimeout(monitor, 5000); 
}

console.log("Iniciando Sniper V50...");
updateAllForecasts();
updateAllTAFs();
auditAllDailyHighs();

setInterval(updateAllForecasts, 1800000); 
setInterval(auditAllDailyHighs, 300000);  
setInterval(updateAllTAFs, 600000);       

monitor();