const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'reviews.json');
const ADMIN_PASSKEY = process.env.ADMIN_PASSKEY || 'bcdecor2026';

// Supported MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Helper to read reviews data
function getReviewsData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = { settings: { requireApproval: true }, reviews: [] };
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading reviews data:', err);
    return { settings: { requireApproval: true }, reviews: [] };
  }
}

// Helper to save reviews data
function saveReviewsData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing reviews data:', err);
    return false;
  }
}

// Calculate summary stats
function calculateStats(reviews) {
  const approved = reviews.filter(r => r.status === 'approved');
  const total = approved.length;
  if (total === 0) {
    return {
      average: 0,
      total: 0,
      distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    };
  }

  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;

  approved.forEach(r => {
    const star = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5)));
    distribution[star] = (distribution[star] || 0) + 1;
    sum += star;
  });

  const average = Number((sum / total).toFixed(1));
  return { average, total, distribution };
}

// Helper to parse JSON request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token'
  });
  res.end(JSON.stringify(data));
}

// Verify admin authorization
function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  // Valid if starts with bc_token_ or equals the ADMIN_PASSKEY directly
  return token === ADMIN_PASSKEY || token.startsWith('bc_token_');
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(reqUrl.pathname);
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token'
    });
    res.end();
    return;
  }

  // ==================== REST API ROUTES ====================

  // 1. GET /api/reviews - Public list of approved reviews + stats
  if (method === 'GET' && pathname === '/api/reviews') {
    const data = getReviewsData();
    const approved = (data.reviews || []).filter(r => r.status === 'approved');
    // Sort featured first, then newest
    approved.sort((a, b) => {
      if (b.featured && !a.featured) return 1;
      if (!b.featured && a.featured) return -1;
      return new Date(b.date) - new Date(a.date);
    });
    const stats = calculateStats(data.reviews || []);
    return sendJson(res, 200, { success: true, reviews: approved, stats });
  }

  // 2. POST /api/reviews - Submit a new review
  if (method === 'POST' && pathname === '/api/reviews') {
    try {
      const body = await parseBody(req);
      
      // Honeypot spam protection
      if (body.website) {
        return sendJson(res, 400, { success: false, error: 'Spam detected' });
      }

      if (!body.name || !body.title || !body.body || !body.rating) {
        return sendJson(res, 400, { success: false, error: 'Missing required review fields' });
      }

      const rating = Math.min(5, Math.max(1, parseInt(body.rating, 10) || 5));
      const data = getReviewsData();
      const requireApproval = data.settings && data.settings.requireApproval !== false;
      const initialStatus = requireApproval ? 'pending' : 'approved';

      const newReview = {
        id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: String(body.name).trim(),
        location: String(body.location || '').trim(),
        service: String(body.service || '').trim(),
        rating: rating,
        title: String(body.title).trim(),
        body: String(body.body).trim(),
        date: new Date().toISOString(),
        verified: true,
        status: initialStatus,
        featured: false,
        helpful: 0
      };

      data.reviews = data.reviews || [];
      data.reviews.unshift(newReview);
      saveReviewsData(data);

      return sendJson(res, 201, {
        success: true,
        review: newReview,
        isPending: initialStatus === 'pending',
        message: initialStatus === 'pending'
          ? 'Thank you! Your review has been submitted and is awaiting client approval.'
          : 'Thank you! Your review has been posted live on the website.'
      });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 3. POST /api/reviews/:id/helpful - Upvote a review
  if (method === 'POST' && pathname.startsWith('/api/reviews/') && pathname.endsWith('/helpful')) {
    const parts = pathname.split('/');
    const reviewId = parts[3];
    const data = getReviewsData();
    const review = (data.reviews || []).find(r => r.id === reviewId);
    if (!review) {
      return sendJson(res, 404, { success: false, error: 'Review not found' });
    }
    review.helpful = (review.helpful || 0) + 1;
    saveReviewsData(data);
    return sendJson(res, 200, { success: true, helpful: review.helpful });
  }

  // 4. POST /api/admin/login - Authenticate admin with passcode
  if (method === 'POST' && pathname === '/api/admin/login') {
    try {
      const body = await parseBody(req);
      const passkey = body.passcode || body.password;
      if (passkey === ADMIN_PASSKEY) {
        const token = 'bc_token_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        return sendJson(res, 200, { success: true, token, message: 'Authentication successful' });
      } else {
        return sendJson(res, 401, { success: false, error: 'Invalid admin passcode' });
      }
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 5. GET /api/admin/reviews - Admin full review list with all statuses
  if (method === 'GET' && pathname === '/api/admin/reviews') {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized admin access' });
    }
    const data = getReviewsData();
    return sendJson(res, 200, {
      success: true,
      reviews: data.reviews || [],
      settings: data.settings || { requireApproval: true }
    });
  }

  // 6. PATCH /api/admin/reviews/:id - Update status / featured
  if (method === 'PATCH' && pathname.startsWith('/api/admin/reviews/')) {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized admin access' });
    }
    const reviewId = pathname.replace('/api/admin/reviews/', '').trim();
    try {
      const body = await parseBody(req);
      const data = getReviewsData();
      const review = (data.reviews || []).find(r => r.id === reviewId);
      if (!review) {
        return sendJson(res, 404, { success: false, error: 'Review not found' });
      }

      if (body.status !== undefined) review.status = body.status;
      if (body.featured !== undefined) review.featured = Boolean(body.featured);
      if (body.title !== undefined) review.title = body.title;
      if (body.body !== undefined) review.body = body.body;

      saveReviewsData(data);
      return sendJson(res, 200, { success: true, review });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 7. DELETE /api/admin/reviews/:id - Delete a review
  if (method === 'DELETE' && pathname.startsWith('/api/admin/reviews/')) {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized admin access' });
    }
    const reviewId = pathname.replace('/api/admin/reviews/', '').trim();
    const data = getReviewsData();
    const initialLen = (data.reviews || []).length;
    data.reviews = (data.reviews || []).filter(r => r.id !== reviewId);
    if (data.reviews.length === initialLen) {
      return sendJson(res, 404, { success: false, error: 'Review not found' });
    }
    saveReviewsData(data);
    return sendJson(res, 200, { success: true, message: 'Review deleted successfully' });
  }

  // 8. PATCH /api/admin/settings - Update moderation setting
  if (method === 'PATCH' && pathname === '/api/admin/settings') {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized admin access' });
    }
    try {
      const body = await parseBody(req);
      const data = getReviewsData();
      data.settings = data.settings || {};
      if (body.requireApproval !== undefined) {
        data.settings.requireApproval = Boolean(body.requireApproval);
      }
      saveReviewsData(data);
      return sendJson(res, 200, { success: true, settings: data.settings });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // ==================== STATIC FILE SERVING ====================

  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Security check: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + pathname);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  BC Decorators Localhost Server Running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Admin Passcode: ${ADMIN_PASSKEY}`);
  console.log(`======================================================\n`);
});
