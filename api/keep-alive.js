export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const dbUrl = `${process.env.FIREBASE_DATABASE_URL}/huggingface_spaces.json?auth=${process.env.FIREBASE_DATABASE_SECRET}`;
    const response = await fetch(dbUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch database: ${response.statusText}`);
    }
    const spacesObj = await response.json();

    if (!spacesObj) {
      return res.status(200).json({ success: true, message: 'No spaces registered.' });
    }

    const spaces = Object.keys(spacesObj).map(key => ({
      id: key,
      ...spacesObj[key]
    }));

    const results = [];
    for (const space of spaces) {
      if (space.url) {
        try {
          const pingRes = await fetch(space.url, { method: 'GET' });
          results.push({ name: space.name || space.id, status: pingRes.status });
        } catch (err) {
          results.push({ name: space.name || space.id, status: 'FAILED', error: err.message });
        }
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}