export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get('targetUrl');
    const filename = searchParams.get('filename');

    if (!targetUrl) {
        return new Response(JSON.stringify({ error: "Parameter targetUrl wajib diisi." }), {
            status: 400,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    try {
        const safeUrl = new URL(targetUrl).href;

        const response = await fetch(safeUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const contentType = response.headers.get('content-type') || '';
        const contentLength = response.headers.get('content-length');

        if (contentType.includes('application/json')) {
            const data = await response.json();
            return new Response(JSON.stringify(data), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        headers.set('Access-Control-Allow-Headers', '*');
        headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');
        
        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }

        if (filename) {
            const cleanFilename = filename.replace(/"/g, '');
            headers.set('Content-Disposition', `attachment; filename="${cleanFilename}"`);
        } else {
            headers.set('Content-Disposition', 'attachment');
        }

        return new Response(response.body, {
            status: response.status,
            headers: headers
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: "Gagal memproses target: " + error.message }), {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}