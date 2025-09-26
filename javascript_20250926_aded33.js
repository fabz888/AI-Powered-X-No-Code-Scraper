const Apify = require('apify');
const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const compromise = require('compromise');
const natural = require('natural');

// Initialize tokenizer for fallback
const tokenizer = new natural.WordTokenizer();

Apify.main(async () => {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Hugging Face API integration
    class AIScraper {
        constructor() {
            this.hfToken = process.env.HUGGINGFACE_TOKEN;
            this.baseURL = 'https://api-inference.huggingface.co/models';
        }

        async queryHuggingFace(model, inputs) {
            try {
                const response = await Apify.utils.requestAsBrowser({
                    url: `${this.baseURL}/${model}`,
                    headers: {
                        'Authorization': `Bearer ${this.hfToken}`,
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    payload: JSON.stringify({ inputs }),
                    timeoutSecs: 30
                });

                if (response.statusCode === 200) {
                    return JSON.parse(response.body);
                }
                throw new Error(`HF API error: ${response.statusCode}`);
            } catch (error) {
                console.log('Hugging Face API failed, using fallback:', error.message);
                return null;
            }
        }

        // Enhanced AI analysis with fallback
        async analyzeContentStructure(html, userPrompt) {
            const $ = cheerio.load(html);
            const textContent = $('body').text().substring(0, 1500);
            
            // Try Hugging Face first
            const aiResponse = await this.queryHuggingFace(
                'microsoft/DialoGPT-medium',
                `As a web scraping expert, analyze this webpage for data extraction. 
                User wants: ${userPrompt}
                Webpage content: ${textContent}
                Suggest CSS selectors for the data in JSON format:`
            );

            if (aiResponse && aiResponse[0] && aiResponse[0].generated_text) {
                return this.parseAIResponse(aiResponse[0].generated_text);
            }

            // Fallback to Compromise.js + rule-based
            return this.fallbackAnalysis($, userPrompt, textContent);
        }

        parseAIResponse(aiText) {
            try {
                // Extract JSON from AI response
                const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            } catch (error) {
                console.log('AI response parsing failed, using fallback');
            }
            return null;
        }

        fallbackAnalysis($, userPrompt, textContent) {
            console.log('Using Compromise.js fallback analysis');
            
            const doc = compromise(textContent);
            const selectors = this.intelligentSelectorDiscovery($, userPrompt, doc);
            
            return {
                selectors,
                dataTypes: this.identifyDataTypes(userPrompt, doc),
                confidence: 'medium',
                source: 'fallback'
            };
        }

        intelligentSelectorDiscovery($, userPrompt, nlpDoc) {
            const selectors = {};
            const elements = [];
            
            // Analyze DOM structure
            $('*').each((i, elem) => {
                const $elem = $(elem);
                const text = $elem.text().trim();
                if (text && text.length > 10) {
                    elements.push({
                        tag: elem.name,
                        text: text.substring(0, 200),
                        classes: $elem.attr('class'),
                        id: $elem.attr('id'),
                        context: $elem.parent().prop('tagName')
                    });
                }
            });

            // NLP-powered content classification
            if (userPrompt.toLowerCase().includes('price') || nlpDoc.has('#Money')) {
                selectors.price = this.findBestPriceSelector($, elements);
            }
            
            if (userPrompt.toLowerCase().includes('product') || nlpDoc.has('#Noun')) {
                selectors.title = this.findBestTitleSelector($, elements);
            }
            
            if (userPrompt.toLowerCase().includes('contact') || 
                nlpDoc.match('#Email').found || 
                nlpDoc.match('#PhoneNumber').found) {
                selectors.contact = this.findBestContactSelector($, elements);
            }

            // Default item container
            selectors.item = '.product, .item, .card, [class*="item"], li, article';

            return selectors;
        }

        findBestPriceSelector($, elements) {
            for (const elem of elements) {
                if (/(\$|€|£|USD|price|cost)/i.test(elem.text)) {
                    return this.buildSelector(elem);
                }
            }
            return '.price, .cost, [class*="price"]';
        }

        findBestTitleSelector($, elements) {
            // Look for h1-h6 with substantial text
            const headingElements = elements.filter(e => 
                ['h1', 'h2', 'h3', 'h4'].includes(e.tag) && e.text.length > 10
            );
            if (headingElements.length > 0) {
                return this.buildSelector(headingElements[0]);
            }
            return '.title, .name, h1, h2, h3';
        }

        buildSelector(element) {
            if (element.id) return `#${element.id}`;
            if (element.classes) {
                const classes = element.classes.split(' ').filter(c => c.length > 2);
                if (classes.length > 0) return `.${classes[0]}`;
            }
            return element.tag;
        }

        identifyDataTypes(userPrompt, nlpDoc) {
            const types = [];
            
            if (nlpDoc.has('#Money') || /price|cost|€|\$|£/i.test(userPrompt)) {
                types.push('prices');
            }
            if (nlpDoc.match('#Email').found || /contact|email/i.test(userPrompt)) {
                types.push('emails');
            }
            if (nlpDoc.match('#PhoneNumber').found || /phone|tel|contact/i.test(userPrompt)) {
                types.push('phones');
            }
            if (nlpDoc.has('#Noun') || /product|item|service/i.test(userPrompt)) {
                types.push('products');
            }

            return types.length > 0 ? types : ['text_content'];
        }
    }

    // Initialize AI Scraper
    const aiScraper = new AIScraper();

    // API Routes
    app.post('/api/analyze', async (req, res) => {
        try {
            const { url, prompt } = req.body;
            
            if (!url) {
                return res.status(400).json({ error: 'URL is required' });
            }

            // Fetch webpage
            const browser = await Apify.launchPuppeteer();
            const page = await browser.newPage();
            
            await page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            const html = await page.content();
            await browser.close();

            // AI analysis
            const analysis = await aiScraper.analyzeContentStructure(html, prompt || 'Extract all meaningful data');
            
            // Generate preview
            const preview = generateDataPreview(html, analysis.selectors);

            res.json({
                success: true,
                analysis,
                preview: preview.slice(0, 5), // First 5 items
                totalElements: preview.length,
                url
            });

        } catch (error) {
            console.error('Analysis error:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message,
                fallback: true 
            });
        }
    });

    app.post('/api/scrape', async (req, res) => {
        try {
            const { url, selectors, options = {} } = req.body;
            
            const results = await executeScraping(url, selectors, options);
            
            res.json({
                success: true,
                data: results,
                total: results.length,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Helper functions
    function generateDataPreview(html, selectors) {
        const $ = cheerio.load(html);
        const results = [];
        
        $(selectors.item || 'body').each((i, elem) => {
            const item = {};
            
            for (const [key, selector] of Object.entries(selectors)) {
                if (key !== 'item') {
                    item[key] = $(elem).find(selector).first().text().trim();
                }
            }
            
            if (Object.values(item).some(val => val)) {
                results.push(item);
            }
        });
        
        return results;
    }

    async function executeScraping(url, selectors, options) {
        const browser = await Apify.launchPuppeteer();
        const page = await browser.newPage();
        
        await page.goto(url, { waitUntil: 'networkidle2' });
        const html = await page.content();
        
        await browser.close();

        return generateDataPreview(html, selectors);
    }

    // Health check
    app.get('/health', (req, res) => {
        res.json({ 
            status: 'healthy', 
            ai: !!process.env.HUGGINGFACE_TOKEN,
            timestamp: new Date().toISOString()
        });
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`AI Scraper running on port ${PORT}`);
        console.log(`Hugging Face AI: ${process.env.HUGGINGFACE_TOKEN ? 'Enabled' : 'Disabled (using fallback)'}`);
    });
});