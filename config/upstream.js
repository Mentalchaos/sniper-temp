// config/upstream.js

// Mapa de Advección Térmica (Upstream Weather) corregido para tus TARGETS específicos
// N: Norte, S: Sur, E: Este, W: Oeste

const UPSTREAM_MAP = {
    // NUEVA YORK (LaGuardia - KLGA)
    "KLGA": {
        N: "KPOU", // Poughkeepsie
        S: "KACY", // Atlantic City
        W: "KABE", // Allentown (Centinela clave del calor)
        E: "KISP"  // Islip
    },

    // LONDRES (London City - EGLC)
    "EGLC": {
        N: "EGSS", // Stansted
        S: "EGKK", // Gatwick
        W: "EGLL", // Heathrow (Funciona como upstream del Oeste para el centro)
        E: "EGMC"  // Southend
    },

    // SEÚL (Incheon - RKSI)
    "RKSI": {
        N: "RKSS", // Gimpo (Está un poco al NE, sirve de referencia interior)
        S: "RKSW", // Suwon
        W: "RKSI", // Mar Amarillo (No hay estaciones fijas, usamos la misma para neutralizar)
        E: "RKSM"  // Seoul Base
    },

    // TORONTO (Pearson - CYYZ)
    "CYYZ": {
        N: "CYQA", // Muskoka
        S: "KBUF", // Buffalo (Crucial para aire caliente del sur)
        W: "CYHM", // Hamilton
        E: "CYTZ"  // Billy Bishop (Centro)
    },

    // SEATTLE (Sea-Tac - KSEA)
    "KSEA": {
        N: "KPAE", // Everett
        S: "KOLM", // Olympia
        W: "KPWT", // Bremerton (Aire del Pacífico)
        E: "KRNT"  // Renton
    },

    // ATLANTA (Hartsfield - KATL)
    "KATL": {
        N: "KCHA", // Chattanooga
        S: "KMCN", // Macon
        W: "KBHM", // Birmingham (Centinela clave del Oeste)
        E: "KAHN"  // Athens
    },

    // DALLAS (Love Field - KDAL)
    "KDAL": {
        N: "KDTO", // Denton
        S: "KACT", // Waco
        W: "KFTW", // Fort Worth Meacham
        E: "KTYR"  // Tyler
    },

    // BUENOS AIRES (Ezeiza - SAEZ)
    "SAEZ": {
        N: "SABE", // Aeroparque (Aire de la ciudad/norte)
        S: "SAZP", // La Plata (Aproximado)
        W: "SAOU", // Santa Rosa (Aire continental caliente)
        E: "SULP"  // Colonia, Uruguay (Cruzando el río)
    }
};

module.exports = { UPSTREAM_MAP };