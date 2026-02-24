require('dotenv').config();
const express = require('express');
const cors = require('cors');
// Using playwright-extra for stealth capabilities
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const Sentiment = require('sentiment');

chromium.use(stealth);

const app = express();
const analyzer = new Sentiment();

app.use(cors());
app.use(express.json());

app.get('/api/history', async (req, res) => {
    res.json([]);
});

app.post('/api/analyze', async (req, res) => {
    req.setTimeout(300000);

    const { url } = req.body;
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
    if (!asinMatch) return res.status(400).json({ error: "Invalid Amazon URL" });
    const asin = asinMatch[1];

    // 🟢 PERSISTENT STORAGE: This folder saves your login cookies
    const userDataDir = './amazon_session';

    try {
        console.log(`🚀 Starting Persistent Stealth Deep-Dive for ASIN: ${asin}...`);

        // Launching with a persistent context to stay logged in
        const context = await chromium.newContext(userDataDir, {
            headless: true,
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            args: ['--disable-blink-features=AutomationControlled']
        });

        // Use the first open page or create a new one
        const page = context.pages()[0] || await context.newPage();

        let allReviews = [];
        const starFilters = ['one_star', 'two_star', 'three_star', 'four_star', 'five_star'];

        for (const filter of starFilters) {
            const reviewUrl = `https://www.amazon.in/product-reviews/${asin}/ref=cm_cr_arp_d_viewopt_sr?reviewerType=all_reviews&filterByStar=${filter}&pageNumber=1`;

            try {
                await page.goto(reviewUrl, { waitUntil: 'networkidle', timeout: 90000 });

                // Check for Block/404 and Auto-Refresh
                if (page.url().includes('404') || page.url().includes('captcha')) {
                    console.log(`🛡️ Redirect detected for ${filter}. Refreshing session...`);
                    await page.waitForTimeout(3000);
                    await page.reload({ waitUntil: 'networkidle' });
                }

                for (let pageNum = 1; pageNum <= 8; pageNum++) {
                    try {
                        await page.waitForSelector('[data-hook="review-body"]', { timeout: 15000 });
                    } catch (e) {
                        console.log(`📡 No data on ${filter} Page ${pageNum}. Moving on.`);
                        break;
                    }

                    const pageReviews = await page.$$eval('[data-hook="review-body"]', elements => {
                        return elements.map(el => el.innerText.trim()).filter(text => text.length > 15);
                    });

                    if (pageReviews.length === 0) break;
                    allReviews = allReviews.concat(pageReviews);
                    console.log(`✅ ${filter} | Page ${pageNum} | Total: ${allReviews.length}`);

                    if (allReviews.length >= 400) break;

                    const nextButton = await page.$('li.a-last a');
                    if (nextButton) {
                        await nextButton.click();
                        await page.waitForTimeout(Math.floor(Math.random() * 3000) + 2000);
                    } else break;
                }
            } catch (navError) {
                console.log(`❌ Network Issue on ${filter}:`, navError.message);
                continue;
            }
        }

        const total = allReviews.length;
        if (total === 0) {
            await context.close();
            return res.status(404).json({ error: "No reviews captured. Manual login might be needed in the browser window." });
        }

        // --- ANALYSIS LOGIC ---
        let positiveCount = 0;
        let complaintMap = {};
        const redFlags = ['fake', 'smell', 'broken', 'small', 'expensive', 'leak', 'dry', 'seal', 'bad', 'waste'];

        allReviews.forEach(text => {
            const cleanText = text.toLowerCase();
            const result = analyzer.analyze(cleanText);
            if (result.score > 0) positiveCount++;
            redFlags.forEach(flag => {
                if (cleanText.includes(flag)) complaintMap[flag] = (complaintMap[flag] || 0) + 1;
            });
        });

        const posRate = (positiveCount / total) * 100;
        const sortedComplaints = Object.entries(complaintMap).sort((a,b) => b[1] - a[1]);
        const topIssue = sortedComplaints.length > 0 ? sortedComplaints[0] : ["general quality", 0];

        const finalResult = {
            asin,
            verdict: posRate >= 60 ? "BUY" : posRate >= 40 ? "CAUTION" : "AVOID",
            confidence: `${Math.floor(((Math.min(total, 300) / 300) * 50) + ((posRate / 100) * 50))}%`,
            positivity_rate: `${posRate.toFixed(1)}%`,
            total_reviews: total,
            top_complaints: sortedComplaints.slice(0, 4),
            ai_summary: posRate >= 60 ? "✅ SOLID CHOICE" : "🚨 PROCEED WITH CAUTION"
        };

        await context.close(); // Closes the whole persistent context
        res.json(finalResult);

    } catch (err) {
        console.error("❌ Scraper Error:", err.message);
        res.status(500).json({ error: "Analysis failed" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Engine active on port ${PORT}`));