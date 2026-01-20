const axios = require('axios');

// CONFIGURACIÓN ANTI-BLOQUEO
const client = axios.create({
    headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
    },
    timeout: 8000 // 8 segundos máximo
});

async function fetchMetar(icao) {
    try {
        // Añadimos cache-buster (t=...)
        const url = `https://www.aviationweather.gov/api/data/metar?ids=${icao}&format=json&t=${Date.now()}`;
        const res = await client.get(url);
        
        // Verificación estricta de datos
        if (!res.data || !Array.isArray(res.data) || res.data.length === 0) {
            console.log(`⚠️ [METAR WARN] ${icao}: Datos vacíos recibidos.`);
            return null;
        }
        return res.data; 
    } catch (e) {
        console.log(`❌ [METAR ERROR] ${icao}: ${e.message}`);
        return null;
    }
}

async function fetchTaf(icao) {
    try {
        const url = `https://www.aviationweather.gov/api/data/taf?ids=${icao}&format=json`;
        const res = await client.get(url);
        return res.data;
    } catch (e) {
        return null;
    }
}

async function fetchForecast(locId, apiKey) {
    try {
        const url = `https://api.weather.com/v1/location/${locId}/forecast/hourly/24hour.json?apiKey=${apiKey}&units=m`;
        const res = await client.get(url);
        return res.data.forecasts;
    } catch (e) {
        console.log(`❌ [FORECAST ERROR] ${locId}: ${e.message}`);
        return null;
    }
}

async function fetchDailyHistory(icao, tz) {
    try {
        const url = `https://www.aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=24`;
        const res = await client.get(url);
        return res.data;
    } catch (e) {
        return [];
    }
}

async function fetchConsensus(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&models=gfs_seamless,ecmwf_ifs04,icon_seamless&timezone=auto&forecast_days=1`;
        const res = await client.get(url);
        if (res.data && res.data.daily) {
            const gfs = res.data.daily.temperature_2m_max_gfs_seamless[0];
            const ecmwf = res.data.daily.temperature_2m_max_ecmwf_ifs04[0];
            const icon = res.data.daily.temperature_2m_max_icon_seamless[0];

            const avg = (gfs + ecmwf + icon) / 3;
            return {
                avg: parseFloat(avg.toFixed(1)),
                details: { gfs, ecmwf, icon }
            };
        }
        return null;
    } catch (e) {
        return null;
    }
}

module.exports = { fetchMetar, fetchTaf, fetchForecast, fetchDailyHistory, fetchConsensus };