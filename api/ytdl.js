export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    // Tangani permintaan pra-penerbangan OPTIONS (Preflight Request) dari browser
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Credentials': 'true',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS, PATCH, DELETE, POST, PUT',
                'Access-Control-Allow-Headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Range',
                'Access-Control-Max-Age': '86400'
            }
        });
    }

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

        // Meneruskan header Range dari browser ke server target untuk mendukung pemutaran streaming parsial (seeking/scrubbing)
        const rangeHeader = req.headers.get('range');
        const fetchHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (rangeHeader) {
            fetchHeaders['Range'] = rangeHeader;
        }

        const response = await fetch(safeUrl, {
            method: 'GET',
            headers: fetchHeaders,
            redirect: 'follow'
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
        headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition, Content-Range, Accept-Ranges');
        
        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }

        // Meneruskan header informasi potongan byte berkas dari CDN target untuk kestabilan pemutar browser
        const contentRange = response.headers.get('content-range');
        if (contentRange) {
            headers.set('Content-Range', contentRange);
        }
        headers.set('Accept-Ranges', 'bytes');

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