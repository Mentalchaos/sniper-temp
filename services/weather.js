const axios = require('axios');

const client = axios.create({
    timeout: 10000
});

async function fetchMetar(icao) {
    try {
        const url = `https://www.aviationweather.gov/api/data/metar?ids=${icao}&format=json`;
        const res = await client.get(url);
        
        if (!res.data || !Array.isArray(res.data) || res.data.length === 0) {
            console.log(`⚠️ [METAR VACÍO] ${icao} devolvió datos vacíos.`);
            return null;
        }
        return res.data;
    } catch (e) {
        console.log(`❌ [METAR ERROR] ${icao}: ${e.message}`);
        if (e.response) console.log(`   Status: ${e.response.status} - ${e.response.statusText}`);
        return null;
    }
}

async function fetchTaf(icao) {
    try {
        const url = `https://www.aviationweather.gov/api/data/taf?ids=${icao}&format=json`;
        const res = await client.get(url);
        return res.data;
    } catch (e) { return null; }
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
    } catch (e) { return []; }
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
            return { avg: parseFloat(avg.toFixed(1)), details: { gfs, ecmwf, icon } };
        }
        return null;
    } catch (e) { return null; }
}

async function fetchWundergroundMax(locId, apiKey, unit, tz) {
    try {
        const dateStr = new Date().toLocaleString("en-US", {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'});
        const [mm, dd, yyyy] = dateStr.split('/');
        const formattedDate = `${yyyy}${mm}${dd}`;
        
        const unitCode = 'm'; 

        const url = `https://api.weather.com/v1/location/${locId}/observations/historical.json?apiKey=${apiKey}&units=${unitCode}&startDate=${formattedDate}`;
        
        const res = await client.get(url);
        
        if (res.data && res.data.observations && res.data.observations.length > 0) {
            let maxTemp = -999;
            res.data.observations.forEach(obs => {
                if (obs.temp > maxTemp) maxTemp = obs.temp;
            });
            return maxTemp;
        }
        return null;
    } catch (e) {
        console.log(`❌ [WG ERROR] ${locId}: ${e.message}`);
        return null; 
    }
}

module.exports = { fetchMetar, fetchTaf, fetchForecast, fetchDailyHistory, fetchConsensus, fetchWundergroundMax };