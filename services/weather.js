const axios = require('axios');

async function fetchMetar(icao) {
    try {
        const url = `https://www.aviationweather.gov/api/data/metar?ids=${icao}&format=json&_=${Date.now()}`;
        const res = await axios.get(url);
        return res.data; 
    } catch (e) {
        return null;
    }
}

async function fetchTaf(icao) {
    try {
        const url = `https://www.aviationweather.gov/api/data/taf?ids=${icao}&format=json`;
        const res = await axios.get(url);
        return res.data;
    } catch (e) {
        return null;
    }
}

async function fetchForecast(locId, apiKey) {
    try {
        const url = `https://api.weather.com/v1/location/${locId}/forecast/hourly/24hour.json?apiKey=${apiKey}&units=m`;
        const res = await axios.get(url);
        return res.data.forecasts;
    } catch (e) {
        return null;
    }
}

async function fetchDailyHistory(icao, tz) {
    try {
        const url = `https://www.aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=24`;
        const res = await axios.get(url);
        return res.data;
    } catch (e) {
        return [];
    }
}

module.exports = { fetchMetar, fetchTaf, fetchForecast, fetchDailyHistory };