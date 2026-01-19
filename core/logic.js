const { COLORS, getRemainingData } = require('../utils/helpers');

function parseTAFForMax(rawTaf) {
    if (!rawTaf) return null;
    const match = rawTaf.match(/TX(\d{2}|M\d{2})\//); 
    if (match) {
        let val = match[1];
        if (val.startsWith('M')) return -parseInt(val.substring(1));
        return parseInt(val);
    }
    return null;
}

function calculateBenchmarkProb(current, targetMax, benchmarkTemp, windDir, clouds, tz, targetObj, trendState, tafMax, isRaining, high24h) {
    if (benchmarkTemp === null) return 0;
    if (isRaining && current < targetMax) return 0;
    
    if (current >= targetMax) return 100;

    if (tafMax !== null && tafMax >= targetMax) return 99;

    let score = 0;
    const distanceToMax = targetMax - current;
    let performanceBonus = 0; 
    let performancePenalty = 1.0; 
    
    const deviation = current - benchmarkTemp; 
    
    if (deviation >= 0) {
        performanceBonus = Math.min(20, deviation * 5); 
    } else {
        const localHour = parseInt(new Date().toLocaleString("en-US", {timeZone: tz, hour: 'numeric', hour12: false}));
        
        let capacityBonus = 0;
        if (high24h !== undefined && high24h >= (targetMax - 2)) {
             capacityBonus = 0.2;
        }

        if (localHour < 12) {
            performancePenalty = Math.max(0.5, 1.0 - (Math.abs(deviation) * 0.1) + capacityBonus);
        } else if (localHour >= 14) {
            performancePenalty = Math.max(0, 1.0 - (Math.abs(deviation) * 0.4)); 
        }
    }

    if (distanceToMax <= 0) score += 40; 
    else if (distanceToMax < 5) score += (5 - distanceToMax) * 8;
    
    const ideal = (targetObj.warmWind[0] + targetObj.warmWind[1]) / 2;
    let wDiff = Math.abs(windDir - ideal);
    if (wDiff > 180) wDiff = 360 - wDiff;
    if (wDiff < 60) score += (60 - wDiff) * (20/60);
    
    const remaining = getRemainingData(tz);
    if (remaining.ms <= 0) return 0;
    
    const cover = clouds && clouds[0] ? clouds[0].cover : "CLR";
    const localHour = parseInt(new Date().toLocaleString("en-US", {timeZone: tz, hour: 'numeric', hour12: false}));
    const isDay = localHour >= 7 && localHour <= 18;
    if (isDay && ["BKN", "OVC"].includes(cover)) score -= 10;
    
    let finalScore = (score + performanceBonus) * performancePenalty;
    if (trendState.includes("↑")) finalScore += 5;
    if (trendState.includes("↓")) finalScore -= 10;
    
    return Math.min(100, Math.max(0, Math.round(finalScore)));
}

function getSniperSignal(reachProb, breakProb, dev, trendArrow, isCalibrating, tafConfirmation, isRaining) {
    if (isCalibrating) return "CALIBRATING";
    if (isRaining && reachProb < 100) return "RAIN KILL";
    if (tafConfirmation) return "PREDICTION BREAK";

    const isDown = trendArrow.includes("↓");
    const safeDev = dev !== null ? dev : 0;

    if (breakProb >= 98 || (breakProb >= 85 && !isDown)) return `SCALP BREAK (${breakProb}%)`;
    if (reachProb >= 80 && safeDev >= -0.5 && !isDown) return `BUY REACH (${reachProb}%)`;
    if (reachProb >= 70 && safeDev >= 0 && !isDown) return `BUY REACH (${reachProb}%)`;
    if (reachProb < 40 || safeDev < -1.5 || isDown) return "NO TRADE";
    
    return "WAIT";
}

function calculateEdge(myProb, marketPrice) {
    if (!marketPrice || marketPrice <= 0) return 0;
    const edge = (myProb / 100) - marketPrice;
    return (edge * 100).toFixed(1);
}

function calculateStake(myProb, marketPrice, bankroll, kellyFraction) {
    if (!marketPrice || marketPrice <= 0 || marketPrice >= 0.85) return 0;
    
    const p = myProb / 100;
    if ((p - marketPrice) < 0.02) return 0;

    const b = (1 / marketPrice) - 1;
    const q = 1 - p;
    
    const f = (b * p - q) / b;
    const stake = f * kellyFraction * bankroll;
    
    return Math.max(0, stake).toFixed(2);
}

module.exports = { parseTAFForMax, calculateBenchmarkProb, getSniperSignal, calculateEdge, calculateStake };