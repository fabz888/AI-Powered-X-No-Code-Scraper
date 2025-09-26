import React, { useState } from 'react';

const AIScraper = () => {
    const [url, setUrl] = useState('');
    const [prompt, setPrompt] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [useAI, setUseAI] = useState(true);

    const analyzeWebsite = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, prompt, useAI })
            });
            
            const data = await response.json();
            setResults(data);
            
        } catch (error) {
            console.error('Analysis failed:', error);
        }
        setLoading(false);
    };

    return (
        <div className="ai-scraper">
            <div className="config-panel">
                <label>
                    <input 
                        type="checkbox" 
                        checked={useAI} 
                        onChange={(e) => setUseAI(e.target.checked)}
                    />
                    Use AI Analysis (Hugging Face)
                </label>
            </div>

            <div className="input-section">
                <input
                    type="url"
                    placeholder="Enter website URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                />
                <textarea
                    placeholder="What data do you want to extract? (e.g., product prices, contact information)"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                />
                <button onClick={analyzeWebsite} disabled={loading}>
                    {loading ? 'Analyzing...' : 'Analyze Website'}
                </button>
            </div>

            {results && (
                <div className="results">
                    <div className="analysis-source">
                        Analysis Source: <strong>{results.analysis.source}</strong>
                    </div>
                    
                    <pre>{JSON.stringify(results.analysis, null, 2)}</pre>
                    
                    <button onClick={() => fetch('/api/scrape', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            url,
                            selectors: results.analysis.selectors
                        })
                    })}>
                        Scrape Full Data
                    </button>
                </div>
            )}
        </div>
    );
};

export default AIScraper;