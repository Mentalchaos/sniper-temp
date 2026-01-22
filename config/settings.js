const API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';

const BANKROLL = 295;
const KELLY_FRACTION = 0.5;

const TARGETS = [
    // --- LATE MARKETS (Volátiles, Marítimos, Frentes rápidos) ---
    // Estrategia: Esperar a las últimas 6 horas. El valor aparece cuando el clima cambia de golpe.
    { 
        id: 'LONDON', icao: 'EGLC', locId: 'EGLC:9:GB', tz: "Europe/London", warmWind: [180, 260], unit: 'C', polySlug: "highest-temperature-in-london-on",
        tradeStyle: "LATE", peakPolicy: { window: 6, stopPostPeak: 2 } 
    },
    { 
        id: 'NEW YORK', icao: 'KLGA', locId: 'KLGA:9:US', tz: "America/New_York", warmWind: [160, 250], unit: 'F', polySlug: "highest-temperature-in-nyc-on",
        tradeStyle: "LATE", peakPolicy: { window: 5, stopPostPeak: 1 }
    },
    { 
        id: 'SEATTLE', icao: 'KSEA', locId: 'KSEA:9:US', tz: "America/Los_Angeles", warmWind: [160, 240], unit: 'F', polySlug: "highest-temperature-in-seattle-on",
        tradeStyle: "LATE", peakPolicy: { window: 5, stopPostPeak: 1 }
    },
    { 
        id: 'WELLINGTON', icao: 'NZWN', locId: 'NZWN:9:NZ', tz: "Pacific/Auckland", warmWind: [330, 30], unit: 'C', polySlug: "highest-temperature-in-wellington-on",
        tradeStyle: "LATE", peakPolicy: { window: 6, stopPostPeak: 2 } // Viento del Norte es caliente aquí
    },

    // --- EARLY MARKETS (Continentales, Estables, Inviernos secos) ---
    // Estrategia: Entrar 12-24h antes. Si quedan < 6h, el mercado está MUERTO (como Seúl).
    { 
        id: 'SEOUL', icao: 'RKSI', locId: 'RKSI:9:KR', tz: "Asia/Seoul", warmWind: [135, 225], unit: 'C', polySlug: "highest-temperature-in-seoul-on",
        tradeStyle: "EARLY", peakPolicy: { deadZone: 6 } // No operar últimas 6 horas
    },
    { 
        id: 'ANKARA', icao: 'LTAC', locId: 'LTAC:9:TR', tz: "Europe/Istanbul", warmWind: [150, 240], unit: 'C', polySlug: "highest-temperature-in-ankara-on",
        tradeStyle: "EARLY", peakPolicy: { deadZone: 6 }
    },
    { 
        id: 'DALLAS', icao: 'KDAL', locId: 'KDAL:9:US', tz: "America/Chicago", warmWind: [160, 240], unit: 'F', polySlug: "highest-temperature-in-dallas-on",
        tradeStyle: "EARLY", peakPolicy: { deadZone: 4 } // Dallas a veces sorprende, deadZone menor
    },

    // --- AUTO / MIXED (Depende del día) ---
    { 
        id: 'BUENOS AIRES', icao: 'SAEZ', locId: 'SAEZ:9:AR', tz: "America/Argentina/Buenos_Aires", warmWind: [300, 360], unit: 'C', polySlug: "highest-temperature-in-buenos-aires-on",
        tradeStyle: "AUTO", peakPolicy: { window: 6, deadZone: 2 }
    },
    { 
        id: 'TORONTO', icao: 'CYYZ', locId: 'CYYZ:9:CA', tz: "America/New_York", warmWind: [135, 225], unit: 'C', polySlug: "highest-temperature-in-toronto-on",
        tradeStyle: "AUTO", peakPolicy: { window: 6, deadZone: 3 }
    },
    { 
        id: 'ATLANTA', icao: 'KATL', locId: 'KATL:9:US', tz: "America/New_York", warmWind: [160, 240], unit: 'F', polySlug: "highest-temperature-in-atlanta-on",
        tradeStyle: "AUTO", peakPolicy: { window: 6, deadZone: 3 }
    }
];

module.exports = { API_KEY, TARGETS, BANKROLL, KELLY_FRACTION };