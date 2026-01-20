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
    // Quitamos °C, °F y espacios extra
    const clean = title.replace(/°[CF]/g, "").trim(); 
    
    // 1. Caso Rango: "44-45" o "-5 to -4"
    // Buscamos dos números separados por "to" o un guion (cuidando los negativos)
    // Regex mejorada para capturar espacios opcionales alrededor del separador
    const rangeMatch = clean.match(/^(-?\d+)(?:\s*to\s*|\s*-\s*)(-?\d+)$/);
    if (rangeMatch) return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
    
    // 2. Caso Extremos: "Below -10" o "-10 or lower"
    if (clean.toLowerCase().includes("below") || clean.toLowerCase().includes("lower") || clean.includes("<")) {
        const match = clean.match(/(-?\d+)/);
        if (match) return { min: -999, max: parseInt(match[0]) };
    }
    
    // 3. Caso Extremos: "Above 40" o "40 or higher"
    if (clean.toLowerCase().includes("higher") || clean.toLowerCase().includes("above") || clean.includes(">")) {
        const match = clean.match(/(-?\d+)/);
        if (match) return { min: parseInt(match[0]), max: 999 };
    }

    // 4. NUEVO: Caso Número Exacto (Ej: "-5", "10")
    // Si es solo un número (positivo o negativo) sin nada más
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
    
    // Array para guardar títulos encontrados (Debugging)
    let foundTitles = [];

    for (const m of markets) {
        const title = m.groupItemTitle || m.question;
        foundTitles.push(title); // Guardamos para el log de error
        
        const range = parseRangeTitle(title);
        
        if (range) {
            let price = 0;
            try { price = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch(e) {}

            if (m.closed || !m.active || m.enableOrderBook === false) {
                if (tPred >= range.min && tPred <= range.max) foundRangeButInactive = true;
                continue; 
            }

            // 1. Coincidencia con Predicción
            if (tPred >= range.min && tPred <= range.max) {
                primaryData = { price, min: range.min, max: range.max, title: title };
            }

            // 2. Coincidencia con Banking (Max Hoy)
            if (tHigh >= range.min && tHigh <= range.max) {
                bankerData = { price, min: range.min, max: range.max, title: title };
            }

            // 3. Hedges
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
            // LOG DE DEBUG IMPORTANTE:
            // Si no encuentra mercado, imprime en consola qué demonios encontró.
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