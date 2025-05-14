// Telegram Exam Notification Bot for Replit
// This bot scrapes a university exam notification website and sends updates to a Telegram channel

// Import required packages
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express'); // Required for Replit keep-alive

// Configuration - USE REPLIT SECRETS FOR THESE!
const config = {
    // Telegram Bot Token (set in Replit Secrets)
    telegramBotToken: process.env.TELEGRAM_TOKEN || '8064456014:AAEcjffqcaLUAMyDnTjTDzDmLFGZsOMZVaw',
    
    // Telegram Channel ID/Username (set in Replit Secrets)
    telegramChannelId: process.env.CHANNEL_ID || '@KLUNINOTIFY',
    
    // Target websites to scrape
    targetUrls: {
        notifications: 'https://exams.keralauniversity.ac.in/Login/check1/==QOBRkVRpEbRdVOrJVYatmV',
        results: 'https://exams.keralauniversity.ac.in/Login/check8/==QOBRkVRpEbRdVOrJVYatmV'
    },
    
    // How often to check for updates (every 5 minutes)
    checkInterval: '*/5 * * * *'
};

// Store for the last notifications (in memory only)
let lastNotificationDate = '';
let lastResultDate = '';

// Initialize Telegram bot
const bot = new TelegramBot(config.telegramBotToken, { polling: false });

// Initialize Express server for Replit keep-alive
const app = express();
app.get('/', (req, res) => {
  res.send('Exam Notification Bot is running! Last checked: ' + new Date().toLocaleString());
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Keep-alive server running on port ${PORT}`);
});

// Scraper function to get latest notifications or results for a specific date
async function scrapeContent(type) {
    try {
        const url = type === 'notifications' ? config.targetUrls.notifications : config.targetUrls.results;
        console.log(`[${new Date().toLocaleString()}] Checking for new ${type}...`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        // Get all published dates
        const publishDates = [];
        $('tr.tableHeading').each((i, el) => {
            const date = $(el).find('td').first().text().replace('Published on', '').trim();
            publishDates.push({
                date: date,
                index: i
            });
        });
        
        if (publishDates.length === 0) {
            console.log(`[${new Date().toLocaleString()}] No ${type} dates found.`);
            return [];
        }
        
        // Get the latest published date
        const latestDate = publishDates[0];
        
        // Find all displayList rows until next tableHeading or end of table
        const notifications = [];
        let currentRow = $('tr.tableHeading').eq(0).next();
        
        while (currentRow.length > 0 && !currentRow.hasClass('tableHeading')) {
            if (currentRow.hasClass('displayList')) {
                const content = currentRow.find('td').eq(1).text().trim();
                const pdfLink = currentRow.find('td').eq(2).find('a').attr('href') || '';
                
                notifications.push({
                    content: content,
                    publishDate: latestDate.date,
                    pdfLink: pdfLink,
                    type: type
                });
            }
            currentRow = currentRow.next();
        }
        
        return notifications;
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] Error scraping ${type}:`, error.message);
        return [];
    }
}

// Send message to Telegram channel
async function sendNotification(data) {
    try {
        // Add PDF link if available
        const pdfLinkSection = data.pdfLink ? `\n\n📎 [Download PDF](${data.pdfLink})` : '';
        
        // Create message based on content type
        let title, source;
        if (data.type === 'notifications') {
            title = '🔔 *NEW EXAM NOTIFICATION* 🔔';
            source = '_Source: Kerala University Examinations Portal - Notifications_';
        } else {
            title = '📊 *NEW EXAM RESULT* 📊';
            source = '_Source: Kerala University Examinations Portal - Results_';
        }
        
        const message = `${title}\n\n📅 *Published on:* ${data.publishDate}\n\n${data.content}${pdfLinkSection}\n\n${source}`;
        
        await bot.sendMessage(config.telegramChannelId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: false // Enable link preview for PDF
        });
        
        console.log(`[${new Date().toLocaleString()}] ${data.type === 'notifications' ? 'Notification' : 'Result'} sent to Telegram channel successfully`);
        return true;
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] Error sending to Telegram:`, error.message);
        return false;
    }
}

// Test connection to Telegram
async function testTelegramConnection() {
    try {
        const botInfo = await bot.getMe();
        console.log(`[${new Date().toLocaleString()}] Connected to Telegram as @${botInfo.username}`);
        return true;
    } catch (error) {
        console.error('[' + new Date().toLocaleString() + '] Failed to connect to Telegram:', error.message);
        return false;
    }
}

// Initialize the monitoring process
async function initializeMonitoring() {
    // Test Telegram connection first
    const telegramConnected = await testTelegramConnection();
    
    if (!telegramConnected) {
        console.error('[' + new Date().toLocaleString() + '] Cannot start monitoring without Telegram connection. Please check your token and internet connection.');
        process.exit(1);
    }
    
    // Schedule periodic checks
    cron.schedule(config.checkInterval, async () => {
        try {
            // Check for new notifications
            const notifications = await scrapeContent('notifications');
            if (notifications && notifications.length > 0) {
                const latestDate = notifications[0].publishDate;
                console.log('[' + new Date().toLocaleString() + `] Found ${notifications.length} notifications for date ${latestDate}`);
                
                // Check if notification date has changed
                if (latestDate !== lastNotificationDate) {
                    console.log('[' + new Date().toLocaleString() + '] New notifications detected!');
                    
                    // Send all notifications to Telegram channel
                    for (const notification of notifications) {
                        await sendNotification(notification);
                        // Add a small delay between messages to prevent flooding
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    // Update last notification date in memory
                    lastNotificationDate = latestDate;
                } else {
                    console.log('[' + new Date().toLocaleString() + '] No new notifications');
                }
            }
            
            // Check for new results
            const results = await scrapeContent('results');
            if (results && results.length > 0) {
                const latestDate = results[0].publishDate;
                console.log('[' + new Date().toLocaleString() + `] Found ${results.length} results for date ${latestDate}`);
                
                // Check if result date has changed
                if (latestDate !== lastResultDate) {
                    console.log('[' + new Date().toLocaleString() + '] New results detected!');
                    
                    // Send all results to Telegram channel
                    for (const result of results) {
                        await sendNotification(result);
                        // Add a small delay between messages to prevent flooding
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    // Update last result date in memory
                    lastResultDate = latestDate;
                } else {
                    console.log('[' + new Date().toLocaleString() + '] No new results');
                }
            }
        } catch (error) {
            console.error('[' + new Date().toLocaleString() + '] Error in monitoring process:', error.message);
        }
    });
    
    // Run immediately on startup to check and send the latest data
    (async () => {
        try {
            console.log('[' + new Date().toLocaleString() + '] Bot started! Sending latest notifications and results...');
            
            // Get and send latest notifications
            const notifications = await scrapeContent('notifications');
            if (notifications && notifications.length > 0) {
                const latestDate = notifications[0].publishDate;
                console.log('[' + new Date().toLocaleString() + `] Sending ${notifications.length} notifications for date ${latestDate}`);
                
                for (const notification of notifications) {
                    await sendNotification(notification);
                    // Add a small delay between messages to prevent flooding
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                lastNotificationDate = latestDate;
            }
            
            // Get and send latest results
            const results = await scrapeContent('results');
            if (results && results.length > 0) {
                const latestDate = results[0].publishDate;
                console.log('[' + new Date().toLocaleString() + `] Sending ${results.length} results for date ${latestDate}`);
                
                for (const result of results) {
                    await sendNotification(result);
                    // Add a small delay between messages to prevent flooding
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                lastResultDate = latestDate;
            }
            
        } catch (error) {
            console.error('[' + new Date().toLocaleString() + '] Error in initial check:', error.message);
        }
    })();
    
    console.log('[' + new Date().toLocaleString() + `] Monitoring started. Checking every ${config.checkInterval}`);
    console.log('[' + new Date().toLocaleString() + `] Updates will be sent to Telegram channel: ${config.telegramChannelId}`);
}

// Main function
async function main() {
    console.log('[' + new Date().toLocaleString() + '] Starting Telegram Exam Updates Bot...');
    console.log('[' + new Date().toLocaleString() + '] Target URLs:', 
                '\n- Notifications:', config.targetUrls.notifications,
                '\n- Results:', config.targetUrls.results);
    
    // Initialize and start monitoring
    await initializeMonitoring();
}

// Start the bot
main().catch(err => {
    console.error('[' + new Date().toLocaleString() + '] Fatal error:', err.message);
    process.exit(1);
});
