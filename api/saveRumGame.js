import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        if (!process.env.KV_REST_API_URL) {
            return res.status(500).json({ error: 'KV database is not linked in Vercel settings.' });
        }

        const game = req.body;
        
        // Add timestamp and unique ID
        game.createdAt = Date.now();
        game._id = `rum_${game.createdAt}_${Math.random().toString(36).substring(2, 9)}`;
        
        // Save to a Redis List
        await kv.lpush('rummyGames', JSON.stringify(game));
        
        res.status(200).json({ success: true, id: game._id });
    } catch (error) {
        console.error('Error saving Rummy game:', error);
        res.status(500).json({ error: error.message || 'Failed to save game' });
    }
}
