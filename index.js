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
    telegramBotToken: '8064456014:AAEcjffqcaLUAMyDnTjTDzDmLFGZsOMZVaw',

    // Telegram Channel ID/Username (set in Replit Secrets)
    telegramChannelId: '@KLUNINOTIFY' ,

    // Target websites to scrape
    targetUrls: {
        notifications: 'https://exams.keralauniversity.ac.in/Login/check1/==QOBRkVRpEbRdVOrJVYatmV',
        results: 'https://exams.keralauniversity.ac.in/Login/check8/==QOBRkVRpEbRdVOrJVYatmV'
    },

    // How often to check for updates (every 5 minutes)
    checkInterval: '*/5 * * * *'
};

// Store for the last notifications (in memory only)
let lastNotificationContent = '';
let lastResultContent = '';

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
  
  // Self-ping every 5 minutes to prevent idle timeout
  setInterval(() => {
    axios.get(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`)
      .catch(err => console.log('Self-ping failed:', err.message));
  }, 4 * 60 * 1000); // 4 minutes
});

// Scraper function to get latest notification or result
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

        // Target the first published date
        const publishDate = $('tr.tableHeading td').first().text().replace('Published on', '').trim();

        // Target the first notification content that follows the date
        const latestContent = $('tr.displayList td').eq(1).text().trim();

        // Extract PDF link for the notification
        const pdfLink = $('tr.displayList td').eq(2).find('a').attr('href') || '';

        return {
            content: latestContent,
            publishDate: publishDate,
            pdfLink: pdfLink,
            type: type
        };
    } catch (error) {
        console.error(`[${new Date().toLocaleString()}] Error scraping ${type}:`, error.message);
        return null;
    }
}

// Send message to Telegram channel
async function sendNotification(data) {
    try {
        // Add PDF link if available
        const pdfLinkSection = data.pdfLink ? `\n\n📎 [Download PDF](${data.pdfLink})` : '';

        // Create message based on content type
        let title;
        if (data.type === 'notifications') {
            title = '🔔 *NEW EXAM NOTIFICATION* 🔔';
           
        } else {
            title = '📊 *NEW EXAM RESULT* 📊';
            
        }

        const message = `${title}\n\n📅 *Published on:* ${data.publishDate}\n\n${data.content}${pdfLinkSection}\n\n`;

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
            const notification = await scrapeContent('notifications');
            if (notification) {
                console.log('[' + new Date().toLocaleString() + '] Latest notification:', notification.content);

                // Check if notification has changed
                if (notification.content && notification.content !== lastNotificationContent) {
                    console.log('[' + new Date().toLocaleString() + '] New notification detected!');

                    // Send notification to Telegram channel
                    const sent = await sendNotification(notification);

                    if (sent) {
                        // Update last notification in memory
                        lastNotificationContent = notification.content;
                    }
                } else {
                    console.log('[' + new Date().toLocaleString() + '] No new notifications');
                }
            }

            // Check for new results
            const result = await scrapeContent('results');
            if (result) {
                console.log('[' + new Date().toLocaleString() + '] Latest result:', result.content);

                // Check if result has changed
                if (result.content && result.content !== lastResultContent) {
                    console.log('[' + new Date().toLocaleString() + '] New result detected!');

                    // Send result to Telegram channel
                    const sent = await sendNotification(result);

                    if (sent) {
                        // Update last result in memory
                        lastResultContent = result.content;
                    }
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

            // Get and send latest notification
            const notification = await scrapeContent('notifications');
            if (notification) {
                await sendNotification(notification);
                lastNotificationContent = notification.content;
            }

            // Get and send latest result
            const result = await scrapeContent('results');
            if (result) {
                await sendNotification(result);
                lastResultContent = result.content;
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
    console.log(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
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