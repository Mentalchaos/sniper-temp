const axios = require('axios');
const { COLORS } = require('./helpers'); 

const GAMMA_API = "https://gamma-api.polymarket.com/events/slug/";

async function scanEvent(slug) {
    if (!slug) {
        console.log(`${COLORS.RED}Error: Debes proporcionar el slug del evento.${COLORS.RESET}`);
        return;
    }

    const cleanSlug = slug.replace("https://polymarket.com/event/", "")
                          .replace("https://gamma-api.polymarket.com/events/slug/", "")
                          .replace(/\/$/, "");

    console.log(`${COLORS.CYAN}🔍 Escaneando evento: ${cleanSlug}...${COLORS.RESET}`);

    try {
        const res = await axios.get(`${GAMMA_API}${cleanSlug}`);
        const event = res.data;

        if (!event || !event.markets) {
            console.log(`${COLORS.RED}❌ No se encontraron mercados.${COLORS.RESET}`);
            return;
        }

        console.log(`${COLORS.GREEN}✅ Evento: ${event.title}${COLORS.RESET}\n`);
        console.log(`Opción                     | Token ID (YES)                                                               | Precio`);
        console.log("-".repeat(120));

        event.markets.forEach(m => {
            let name = m.groupItemTitle || m.question;
            if (name.length > 25) name = name.substring(0, 25) + "...";

            let yesId = "N/A";
            try {
                if (m.clobTokenIds) {
                    const ids = JSON.parse(m.clobTokenIds);
                    yesId = ids[0]; 
                }
            } catch (e) { yesId = "ERROR_PARSING"; }

            let priceDisp = "---";
            try {
                if (m.outcomePrices) {
                    const prices = JSON.parse(m.outcomePrices);
                    const yesPrice = parseFloat(prices[0]);
                    
                    const cents = (yesPrice * 100).toFixed(1);
                    
                    if (yesPrice > 0.8) priceDisp = `${COLORS.GREEN}${cents}¢${COLORS.RESET}`;
                    else if (yesPrice < 0.1) priceDisp = `${COLORS.RED}${cents}¢${COLORS.RESET}`;
                    else priceDisp = `${COLORS.YELLOW}${cents}¢${COLORS.RESET}`;
                }
            } catch (e) {}

            const status = m.closed ? `[${COLORS.RED}CERRADO${COLORS.RESET}]` : "";

            console.log(`${COLORS.BOLD}${name.padEnd(26)}${COLORS.RESET} | ${yesId.padEnd(76)} | ${priceDisp} ${status}`);
        });

        console.log("-".repeat(120));
        console.log(`${COLORS.CYAN}Copia el Token ID largo al archivo config/settings.js${COLORS.RESET}`);

    } catch (e) {
        console.log(`${COLORS.RED}Error: ${e.message}${COLORS.RESET}`);
    }
}

const slugArg = process.argv[2];
scanEvent(slugArg);