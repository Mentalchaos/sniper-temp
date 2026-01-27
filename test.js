const { fetchMetar } = require('./services/weather');

(async () => {
    console.log("📡 Probando conexión a Meteorología...");
    
    const london = await fetchMetar('EGLC');
    if (london) console.log("✅ LONDRES OK:", london[0].temp + "°C");
    else console.log("❌ LONDRES FALLÓ");

    const ny = await fetchMetar('KLGA');
    if (ny) console.log("✅ NUEVA YORK OK:", ny[0].temp + "°C");
    else console.log("❌ NUEVA YORK FALLÓ");
    
    const sulp = await fetchMetar('SULP');
    if (sulp) console.log("✅ COLONIA OK");
    else console.log("⚠️ COLONIA FALLÓ (Normal, suele estar offline)");
})();