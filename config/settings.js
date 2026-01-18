const API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';

const TARGETS = [
    { id: 'TORONTO (CYYZ)', icao: 'CYYZ', locId: 'CYYZ:9:CA', tz: "America/New_York", warmWind: [135, 225] },
    { id: 'NY LAGUARDIA', icao: 'KLGA', locId: 'KLGA:9:US', tz: "America/New_York", warmWind: [160, 250] },
    { id: 'ATLANTA (KATL)', icao: 'KATL', locId: 'KATL:9:US', tz: "America/New_York", warmWind: [160, 240] },
    { id: 'LONDON CITY', icao: 'EGLC', locId: 'EGLC:9:GB', tz: "Europe/London", warmWind: [180, 260] },
    { id: 'SEOUL (RKSI)', icao: 'RKSI', locId: 'RKSI:9:KR', tz: "Asia/Seoul", warmWind: [135, 225] },
    { id: 'DALLAS (KDAL)', icao: 'KDAL', locId: 'KDAL:9:US', tz: "America/Chicago", warmWind: [160, 240] },
    { id: 'B.AIRES (SAEZ)', icao: 'SAEZ', locId: 'SAEZ:9:AR', tz: "America/Argentina/Buenos_Aires", warmWind: [300, 360] }
];

module.exports = { API_KEY, TARGETS };