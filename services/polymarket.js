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
    
    const rangeMatch = clean.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
    
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
        return findOpportunities(eventCache[fullSlug], predictedTemp);
    }

    try {
        const url = `${GAMMA_API}${fullSlug}`;
        const res = await axios.get(url);
        
        if (res.data && res.data.markets) {
            eventCache[fullSlug] = res.data.markets;
            lastFetch[fullSlug] = Date.now();
            return findOpportunities(res.data.markets, predictedTemp);
        }
    } catch (e) { return null; }
    return null;
}

// services/polymarket.js

// ... (funciones getDynamicSlug y parseRangeTitle se mantienen igual) ...

async function fetchDynamicPrice(baseSlug, tz, predictedTemp) {
    const fullSlug = getDynamicSlug(baseSlug, tz);
    
    if (lastFetch[fullSlug] && (Date.now() - lastFetch[fullSlug] < 30000)) {
        return findOpportunities(eventCache[fullSlug], predictedTemp);
    }

    try {
        const url = `${GAMMA_API}${fullSlug}`;
        const res = await axios.get(url);
        
        if (res.data && res.data.markets) {
            eventCache[fullSlug] = res.data.markets;
            lastFetch[fullSlug] = Date.now();
            return findOpportunities(res.data.markets, predictedTemp);
        } else {
            return { error: "EVENT_NOT_FOUND" };
        }
    } catch (e) {
        return { error: "URL_404_OR_NETWORK" };
    }
}

function findOpportunities(markets, temp) {
    if (!markets || markets.length === 0) return { error: "EMPTY_MARKETS" };
    
    const tRound = Math.round(temp);
    let primaryPrice = null;
    let neighbors = [];
    let foundRangeButInactive = false;

    for (const m of markets) {
        const title = m.groupItemTitle || m.question;
        const range = parseRangeTitle(title);
        
        if (range) {
            if (tRound >= range.min && tRound <= range.max) {
                if (m.closed || !m.active || m.enableOrderBook === false) {
                    foundRangeButInactive = true;
                    continue; 
                }

                try {
                    if (m.outcomePrices) {
                        const prices = JSON.parse(m.outcomePrices);
                        primaryPrice = parseFloat(prices[0]);
                    }
                } catch(e) {}
            } 
            else {
                if (m.closed || !m.active || m.enableOrderBook === false) continue;
                
                const distMin = Math.abs(range.min - tRound);
                const distMax = Math.abs(range.max - tRound);
                if ((distMin <= 10 || distMax <= 10)) {
                    let price = 0;
                    try { price = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch(e) {}
                    if (price < 0.15 && price > 0) {
                        neighbors.push({ title: title.replace(/°[CF]/g, ""), price, min: range.min, max: range.max });
                    }
                }
            }
        }
    }

    let errorReason = null;
    if (primaryPrice === null) {
        if (foundRangeButInactive) errorReason = "RANGE_PAUSED_OR_REVIEW";
        else errorReason = "RANGE_NOT_IN_LIST";
    }

    return {
        primary: primaryPrice,
        hedges: neighbors,
        error: errorReason
    };
}

module.exports = { fetchDynamicPrice, getDynamicSlug };