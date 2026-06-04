import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        if (!process.env.KV_REST_API_URL) {
            return res.status(500).json({ error: 'KV database is not linked in Vercel settings.' });
        }

        // Fetch the first 50 games from both lists
        // lrange is inclusive, so 0 to 49 gets 50 items
        const rawTpGames = await kv.lrange('teenPattiGames', 0, 49) || [];
        const rawRumGames = await kv.lrange('rummyGames', 0, 49) || [];
        
        // Vercel KV parses JSON automatically if stored via SDK, but if it returns strings, parse them
        const tpGames = rawTpGames.map(g => typeof g === 'string' ? JSON.parse(g) : g);
        const rumGames = rawRumGames.map(g => typeof g === 'string' ? JSON.parse(g) : g);

        res.status(200).json({ 
            tpGames,
            rumGames
        });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch leaderboard' });
    }
}
