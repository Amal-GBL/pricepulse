#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ⭐ SCRAPER ORDER + COMMANDS
const SCRAPERS = [
    { name: 'blinkit_sheets.js',   cmd: 'node blinkit_sheets.js' },
    { name: 'instamart_sheets.js', cmd: 'node instamart_sheets.js' },
    { name: 'zepto_sheets.js',     cmd: 'node zepto_sheets.js' },
    // { name: 'chumbak_blinkit_sheets.js',   cmd: 'node chumbak_blinkit_sheets.js' },
    // { name: 'chumbak_instamart_sheets.js',    cmd: 'node chumbak_instamart_sheets.js' },
    // { name: 'chumbak_zepto_sheets.js',     cmd: 'node chumbak_zepto_sheets.js' },
    { name: 'populate_benchmarks.js', cmd: 'node populate_benchmarks.js' },
    // { name: 'populate_chumbak_benchmarks.js', cmd: 'node populate_chumbak_benchmarks.js' },
    
];

// ⭐ LOG FILE
const LOG_FILE = `scraper_log_${new Date().toISOString().slice(0,10)}.txt`;
const TIMESTAMP = () => new Date().toISOString();

function log(message) {
    const msg = `[${TIMESTAMP()}] ${message}\n`;
    console.log(msg.trim());
    fs.appendFileSync(LOG_FILE, msg);
}

function runCommand(cmd, name) {
    try {
        log(`STARTING: ${name}`);
        const output = execSync(cmd, { encoding: 'utf8', timeout: 300000 }); // 5min timeout
        log(`✅ SUCCESS: ${name}`);
        console.log(`OUTPUT: ${output.trim().slice(0, 200)}...`);
        return true;
    } catch (error) {
        log(`FAILED: ${name}`);
        log(`ERROR: ${error.message}`);
        console.error(`\nCRITICAL: ${name} FAILED!\n${error.message}\n`);
        return false;
    }
}

async function main() {
    console.log(`\nPRICEPULSE SCRAPER PIPELINE STARTED\n${'='.repeat(50)}\n`);
    log(`PIPELINE STARTED`);

    let successCount = 0;
    
    for (const scraper of SCRAPERS) {
        console.log(`\n🔄 [${successCount + 1}/${SCRAPERS.length}] Running: ${scraper.name}`);
        
        const success = runCommand(scraper.cmd, scraper.name);
        
        if (!success) {
            console.log(`\nPIPELINE STOPPED! ${scraper.name} FAILED`);
            log(`PIPELINE STOPPED at ${scraper.name}`);
            
            // ⭐ SEND ALERT (Optional: Slack/Email)
            console.log(`\n📱 ALERT: Check ${LOG_FILE} for details!`);
            process.exit(1); // STOP EVERYTHING!
        }
        
        successCount++;
        console.log(`${scraper.name} COMPLETED`);
    }
    
    console.log(`\nALL ${successCount} SCRAPERS COMPLETED SUCCESSFULLY!`);
    log(`FULL PIPELINE SUCCESS`);
    console.log(`LOG: ${LOG_FILE}`);
    
    // ⭐ SUCCESS NOTIFICATION
    console.log(`\nLIVE DATA UPDATED! Check: https://pricepulse.vercel.app`);
}

main().catch(err => {
    console.error(`FATAL ERROR: ${err.message}`);
    process.exit(1);
});