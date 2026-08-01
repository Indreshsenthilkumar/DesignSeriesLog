const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const HOST = '0.0.0.0';

// Function to get the local IPv4 address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const server = http.createServer((req, res) => {
    // Basic static file serving
    let filePath = '.' + req.url.split('?')[0]; // Remove query params
    if (filePath === './') {
        filePath = './index.html';
    }

    console.log(`[${new Date().toLocaleTimeString()}] Request: ${req.url} -> ${filePath}`);

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if(error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('404 File Not Found');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

let currentPort = PORT;

function startServer(port) {
    server.listen(port, HOST, () => {
        const localIP = getLocalIP();
        console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
        console.log('\x1b[32m%s\x1b[0m', '  🚀 Development Server is running!');
        console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
        console.log(`  Local:            http://localhost:${port}`);
        console.log(`  On Your Network:  \x1b[1mhttp://${localIP}:${port}\x1b[0m`);
        console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
        console.log('\x1b[33m%s\x1b[0m', '  Ensure your mobile device is on the same network/hotspot.');
        console.log('\x1b[36m%s\x1b[0m', '---------------------------------------------------');
    });
}

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`Port ${currentPort} is in use, trying ${currentPort + 1}...`);
        currentPort++;
        startServer(currentPort);
    } else {
        console.error(e);
    }
});

startServer(currentPort);

