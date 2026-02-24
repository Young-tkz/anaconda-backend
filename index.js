const { chromium } = require('playwright');
const Sentiment = require('sentiment');
const analyzer = new Sentiment();
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

async function analyze300Reviews(asin) {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    let allReviews = [];
    const targetCount = 300;
    // We cycle through star ratings to bypass Amazon's page limits
    const starFilters = ['one_star', 'two_star', 'three_star', 'four_star', 'five_star'];

    try {
        console.log(`🚀 Starting Multi-Filter Deep Dive for: ${asin}`);

        for (const filter of starFilters) {
            if (allReviews.length >= targetCount) break;

            const url = `https://www.amazon.in/product-reviews/${asin}/ref=cm_cr_arp_d_viewopt_sr?reviewerType=all_reviews&filterByStar=${filter}&pageNumber=1`;
            console.log(`\n📂 Switching to ${filter.replace('_', ' ')} reviews...`);
            await page.goto(url);

            // Manual handshake only for the very first page
            if (filter === 'one_star') {
                console.log("⚠️ Solve Captcha/Set Location then press ENTER here...");
                await new Promise(resolve => readline.once('line', resolve));
            }

            // Loop through pages for the current star filter
            for (let pageNum = 1; pageNum <= 10; pageNum++) {
                try {
                    await page.waitForSelector('[data-hook="review-body"]', { timeout: 5000 });
                } catch (e) {
                    console.log(`🏁 No more reviews found in ${filter} category.`);
                    break;
                }

                const pageReviews = await page.$$eval('[data-hook="review-body"]', elements => {
                    return elements.map(el => el.innerText.trim()).filter(text => text.length > 15);
                });

                allReviews = allReviews.concat(pageReviews);
                console.log(`✅ Page ${pageNum}: Added ${pageReviews.length} reviews (Total: ${allReviews.length})`);

                if (allReviews.length >= targetCount) break;

                const nextButton = await page.$('li.a-last a');
                if (nextButton) {
                    await nextButton.click();
                    await page.waitForTimeout(Math.floor(Math.random() * 2000) + 3000);
                } else {
                    break;
                }
            }
        }

        // --- FINAL ANALYSIS ---
        console.log(`\n🧠 Analyzing ${allReviews.length} Reviews...`);

        let positiveCount = 0;
        let complaintMap = {};
        const redFlags = ['fake', 'smell', 'broken', 'small', 'expensive', 'leak', 'dry', 'seal', 'bad', 'waste'];

        allReviews.forEach(text => {
            const cleanText = text.toLowerCase();
            const result = analyzer.analyze(cleanText);
            if (result.score > 0) positiveCount++;

            redFlags.forEach(flag => {
                if (cleanText.includes(flag)) {
                    complaintMap[flag] = (complaintMap[flag] || 0) + 1;
                }
            });
        });

        const posRate = (positiveCount / allReviews.length) * 100;
        const confidence = Math.floor(((Math.min(allReviews.length, 300) / 300) * 50) + ((posRate / 100) * 50));

        const topComplaints = Object.entries(complaintMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([word, count]) => `${word} (${count})`);

        console.log(`\n================================`);
        console.log(`📊 MULTI-FILTER VERDICT: ${confidence >= 70 ? "BUY" : confidence >= 50 ? "BUY WITH CAUTION" : "AVOID"}`);
        console.log(`🎯 Confidence Score: ${confidence}%`);
        console.log(`📈 Positivity Rate: ${posRate.toFixed(1)}%`);
        console.log(`🚩 Top Issues Found: ${topComplaints.join(', ')}`);
        console.log(`================================\n`);

    } catch (err) {
        console.error("❌ Fatal Error:", err.message);
    } finally {
        await browser.close();
        readline.close();
    }
}

analyze300Reviews('B071YZMJSC');