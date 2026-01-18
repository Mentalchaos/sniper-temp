const fs = require('fs');
const path = require('path');

const COLORS = {
    GREEN: "\x1b[32m",
    YELLOW: "\x1b[33m",
    CYAN: "\x1b[36m",
    RED: "\x1b[31m",
    RESET: "\x1b[0m",
    MAGENTA: "\x1b[35m",
    ORANGE: "\x1b[1m\x1b[38;5;214m",
    PURPLE_BOLD: "\x1b[1m\x1b[35m",
    BOLD: "\x1b[1m",
    BLUE_BG: "\x1b[44m"
};

const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'sniper_blackbox.txt');

function toF(c) { 
    return c === null || c === undefined ? "??" : (c * 9/5 + 32).toFixed(1); 
}

function writeLog(message) {
    const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "--- NEW LOG SESSION ---\n");
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

function getRemainingData(tz) {
    const now = new Date();
    const localTime = new Date(now.toLocaleString("en-US", {timeZone: tz}));
    const midnight = new Date(localTime);
    midnight.setHours(24, 0, 0, 0);
    const diff = midnight - localTime;
    return {
        ms: diff,
        str: diff <= 0 ? "CERRADO" : new Date(diff).toISOString().substr(11, 8)
    };
}

module.exports = { COLORS, toF, writeLog, getRemainingData };