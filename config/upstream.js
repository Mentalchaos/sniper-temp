

const UPSTREAM_MAP = {
    "KLGA": {
        N: "KPOU", 
        S: "KACY", 
        W: "KABE", 
        E: "KISP" 
    },

    "EGLC": {
        N: "EGSS", 
        S: "EGKK", 
        W: "EGLL", 
        E: "EGMC"  
    },
    "RKSI": {
        N: "RKSS", // Gimpo
        S: "RKSW", // Suwon
        W: "RKSI", // Mar Amarillo
        E: "RKSM"  // Seoul Base
    },

    "CYYZ": {
        N: "CYQA", // Muskoka
        S: "KBUF", // Buffalo
        W: "CYHM", // Hamilton
        E: "CYTZ"  // Billy Bishop
    },

    "KSEA": {
        N: "KPAE", // Everett
        S: "KOLM", // Olympia
        W: "KPWT", // Bremerton
        E: "KRNT"  // Renton
    },

    "KATL": {
        N: "KCHA", // Chattanooga
        S: "KMCN", // Macon
        W: "KBHM", // Birmingham
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
        N: "SABE", // Aeroparque
        S: "SAZP", // La Plata
        W: "SAOU", // Santa Rosa
        E: "SUMU"  // Montevideo (Carrasco) - Corrección SULP
    },
    "LTAC": {
        N: "LTCM", // Sinop (Aire frío Mar Negro)
        S: "LTAF", // Adana (Aire caliente sur)
        W: "LTFM", 
        E: "LTAR"  
    },
    "NZWN": {
        N: "NZPM", 
        S: "NZCH", 
        W: "NZNS", 
        E: "NZWN"  
    }
};

module.exports = { UPSTREAM_MAP };