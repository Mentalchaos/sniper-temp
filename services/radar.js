const axios = require('axios');

async function fetchRadar(lat, lon) {
    try {
        if (!lat || !lon) return null;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&minutely_15=precipitation&forecast_minutely_15=4`;
        
        const res = await axios.get(url);
        
        if (res.data && res.data.minutely_15 && res.data.minutely_15.precipitation) {
            const rainData = res.data.minutely_15.precipitation;
            
            let totalRain = 0;
            for (let i = 0; i < 3; i++) {
                if (rainData[i]) totalRain += rainData[i];
            }

            if (totalRain > 0.2) {
                return { incoming: true, amount: totalRain.toFixed(1) };
            }
        }
        return { incoming: false, amount: 0 };
    } catch (e) {
        console.log("Error Radar:", e.message);
        return null;
    }
}

module.exports = { fetchRadar };