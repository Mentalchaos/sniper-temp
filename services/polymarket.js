const axios = require('axios');

const GAMMA_API = "https://gamma-api.polymarket.com/events/slug/";

let eventCache = {};
let lastFetch = {};

function getDynamicSlug(baseSlug, tz) {
    const dateInTarget = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const day = dateInTarget.getDate();
    const month = dateInTarget.toLocaleString('en-US', { month: 'long' }).toLowerCase();
    return `${baseSlug}-${month}-${day}`;
}

function parseRangeTitle(title) {
    const clean = title.replace(/°[CF]/g, "").trim(); 
    
    const rangeMatch = clean.match(/^(-?\d+)(?:\s*to\s*|\s*-\s*)(-?\d+)$/);
    if (rangeMatch) return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
    
    if (clean.toLowerCase().includes("below") || clean.toLowerCase().includes("lower") || clean.includes("<")) {
        const match = clean.match(/(-?\d+)/);
        if (match) return { min: -999, max: parseInt(match[0]) };
    }
    
    if (clean.toLowerCase().includes("higher") || clean.toLowerCase().includes("above") || clean.includes(">")) {
        const match = clean.match(/(-?\d+)/);
        if (match) return { min: parseInt(match[0]), max: 999 };
    }

    if (/^-?\d+$/.test(clean)) {
        const num = parseInt(clean);
        return { min: num, max: num };
    }

    return null;
}

async function fetchDynamicPrice(baseSlug, tz, predictedTemp, highSoFar) {
    const fullSlug = getDynamicSlug(baseSlug, tz);
    
    if (lastFetch[fullSlug] && (Date.now() - lastFetch[fullSlug] < 30000)) {
        return findOpportunities(eventCache[fullSlug], predictedTemp, highSoFar, fullSlug);
    }

    try {
        const url = `${GAMMA_API}${fullSlug}`;
        const res = await axios.get(url);
        
        if (res.data && res.data.markets) {
            eventCache[fullSlug] = res.data.markets;
            lastFetch[fullSlug] = Date.now();
            return findOpportunities(res.data.markets, predictedTemp, highSoFar, fullSlug);
        } else {
            return { error: "EVENT_NOT_FOUND" };
        }
    } catch (e) {
        return { error: "URL_404_OR_NETWORK" };
    }
}

function findOpportunities(markets, predictedTemp, highSoFar, slugDebug) {
    if (!markets || markets.length === 0) return { error: "EMPTY_MARKETS" };
    
    const tPred = Math.round(predictedTemp);
    const tHigh = Math.round(highSoFar); 

    let primaryData = null; 
    let bankerData = null;  
    let neighbors = [];
    let foundRangeButInactive = false;
    
    let foundTitles = [];

    for (const m of markets) {
        const title = m.groupItemTitle || m.question;
        foundTitles.push(title);
        
        const range = parseRangeTitle(title);
        
        if (range) {
            let price = 0;
            try { price = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch(e) {}

            if (m.closed || !m.active || m.enableOrderBook === false) {
                if (tPred >= range.min && tPred <= range.max) foundRangeButInactive = true;
                continue; 
            }

            if (tPred >= range.min && tPred <= range.max) {
                primaryData = { price, min: range.min, max: range.max, title: title };
            }

            if (tHigh >= range.min && tHigh <= range.max) {
                bankerData = { price, min: range.min, max: range.max, title: title };
            }

            const distMin = Math.abs(range.min - tPred);
            const distMax = Math.abs(range.max - tPred);
            if ((distMin <= 8 || distMax <= 8) && price < 0.20 && price > 0) {
                 neighbors.push({ title: title.replace(/°[CF]/g, ""), price, min: range.min, max: range.max });
            }
        }
    }

    let selectedMarket = primaryData;
    let strategyType = "PREDICTION"; 

    if (bankerData) {
        if (tPred <= tHigh + 2) { 
            selectedMarket = bankerData;
            strategyType = "BANKING";
        }
    }

    let errorReason = null;
    if (!selectedMarket) {
        if (foundRangeButInactive) errorReason = "RANGE_PAUSED_OR_REVIEW";
        else {
            errorReason = "RANGE_NOT_IN_LIST";
            console.log(`\n\x1b[35m[DEBUG DETECTIVE] ${slugDebug}\x1b[0m`);
            console.log(`Buscaba: ${tPred} | Encontró estos títulos:`);
            console.log(foundTitles.join(", "));
        }
    }

    return {
        primary: selectedMarket ? selectedMarket.price : null,
        min: selectedMarket ? selectedMarket.min : null,
        max: selectedMarket ? selectedMarket.max : null,
        title: selectedMarket ? selectedMarket.title : null,
        strategy: strategyType, 
        hedges: neighbors,
        error: errorReason
    };
}

module.exports = { fetchDynamicPrice, getDynamicSlug };