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
      const repoId = space.repo_id || `${space.username}/${space.space_name}`;
      const hfToken = space.hf_token;

      if (repoId && hfToken) {
        try {
          const hfUrl = `https://huggingface.co/api/spaces/${repoId}/restart`;
          const restartRes = await fetch(hfUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${hfToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ factory: true })
          });

          if (restartRes.ok) {
            results.push({ repoId, status: 'REBUILT' });
          } else {
            const errText = await restartRes.text();
            results.push({ repoId, status: 'FAILED', error: errText });
          }
        } catch (err) {
          results.push({ repoId, status: 'FAILED', error: err.message });
        }
      } else {
        results.push({ repoId: repoId || 'Unknown', status: 'SKIPPED', error: 'Missing repository ID or HF Token' });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}