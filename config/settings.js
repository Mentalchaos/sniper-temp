const API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';

const BANKROLL = 1000;
const KELLY_FRACTION = 0.5;

const TARGETS = [
    { id: 'LONDON', icao: 'EGLC', locId: 'EGLC:9:GB', tz: "Europe/London", warmWind: [180, 260], unit: 'C', polySlug: "highest-temperature-in-london-on" },
    { id: 'SEOUL', icao: 'RKSI', locId: 'RKSI:9:KR', tz: "Asia/Seoul", warmWind: [135, 225], unit: 'C', polySlug: "highest-temperature-in-seoul-on" },
    { id: 'BUENOS AIRES', icao: 'SAEZ', locId: 'SAEZ:9:AR', tz: "America/Argentina/Buenos_Aires", warmWind: [300, 360], unit: 'C', polySlug: "highest-temperature-in-buenos-aires-on" },
    { id: 'TORONTO', icao: 'CYYZ', locId: 'CYYZ:9:CA', tz: "America/New_York", warmWind: [135, 225], unit: 'C', polySlug: "highest-temperature-in-toronto-on" },
    { id: 'NEW YORK', icao: 'KLGA', locId: 'KLGA:9:US', tz: "America/New_York", warmWind: [160, 250], unit: 'F', polySlug: "highest-temperature-in-nyc-on" },
    { id: 'SEATTLE', icao: 'KSEA', locId: 'KSEA:9:US', tz: "America/Los_Angeles", warmWind: [160, 240], unit: 'F', polySlug: "highest-temperature-in-seattle-on" },
    { id: 'ATLANTA', icao: 'KATL', locId: 'KATL:9:US', tz: "America/New_York", warmWind: [160, 240], unit: 'F', polySlug: "highest-temperature-in-atlanta-on" },
    { id: 'DALLAS', icao: 'KDAL', locId: 'KDAL:9:US', tz: "America/Chicago", warmWind: [160, 240], unit: 'F', polySlug: "highest-temperature-in-dallas-on" }
];

module.exports = { API_KEY, TARGETS, BANKROLL, KELLY_FRACTION };