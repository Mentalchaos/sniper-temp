const { exec } = require('child_process');

const SOUNDS = {
    BLOOD: './utils/sounds/blood.mp3',
    YASUO: './utils/sounds/yasuo.mp3',
    VILLAGER: './utils/sounds/villager.mp3'
};

function playSound(type) {
    const file = SOUNDS[type];
    if (file) {
        exec(`afplay ${file}`, (error) => {
            if (error) {
            }
        });
    }
}

module.exports = { playSound };