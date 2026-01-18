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
    const clean = title.replace(/°[CF]/g, "").trim(); // Quitamos símbolos
    
    const rangeMatch = clean.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
        return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
    }
    
    if (clean.includes("below") || clean.includes("lower")) {
        const num = parseInt(clean.match(/(-?\d+)/)[0]);
        return { min: -999, max: num };
    }
    
    if (clean.includes("higher") || clean.includes("above")) {
        const num = parseInt(clean.match(/(-?\d+)/)[0]);
        return { min: num, max: 999 };
    }
    
    return null;
}

async function fetchDynamicPrice(baseSlug, tz, predictedTemp) {
    const fullSlug = getDynamicSlug(baseSlug, tz);
    
    if (lastFetch[fullSlug] && (Date.now() - lastFetch[fullSlug] < 30000)) {
        return findPriceInEvent(eventCache[fullSlug], predictedTemp);
    }

    try {
        const url = `${GAMMA_API}${fullSlug}`;
        const res = await axios.get(url);
        
        if (res.data && res.data.markets) {
            eventCache[fullSlug] = res.data.markets;
            lastFetch[fullSlug] = Date.now();
            return findPriceInEvent(res.data.markets, predictedTemp);
        }
    } catch (e) {
        return null;
    }
    return null;
}

function findPriceInEvent(markets, temp) {
    if (!markets) return null;
    
    for (const m of markets) {
        const title = m.groupItemTitle || m.question;
        const range = parseRangeTitle(title);
        
        if (range) {
            const tRound = Math.round(temp);
            
            if (tRound >= range.min && tRound <= range.max) {
                try {
                    if (m.outcomePrices) {
                        const prices = JSON.parse(m.outcomePrices);
                        return parseFloat(prices[0]); 
                    }
                } catch(e) { return null; }
            }
        }
    }
    return null;
}

module.exports = { fetchDynamicPrice, getDynamicSlug };