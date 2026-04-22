const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const superagent = require('superagent');

// Налаштування commander
program
  .requiredOption('-h, --host <host>', 'адреса сервера')
  .requiredOption('-p, --port <port>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до директорії кешу');

program.parse(process.argv);
const options = program.opts();

const host = options.host;
const port = parseInt(options.port, 10);
const cacheDir = path.resolve(options.cache);

// Створення директорії кешу
async function initCacheDir() {
  try {
    await fs.access(cacheDir);
  } catch {
    await fs.mkdir(cacheDir, { recursive: true });
    console.log(`Cache directory created: ${cacheDir}`);
  }
}

// Отримання шляху до файлу за кодом статусу
function getFilePath(statusCode) {
  return path.join(cacheDir, `${statusCode}.jpg`);
}

// Завантаження картинки з http.cat
async function fetchFromHttpCat(statusCode) {
  const url = `https://http.cat/${statusCode}`;
  try {
    const response = await superagent.get(url);
    return response.body;
  } catch (err) {
    if (err.status === 404) {
      return null;
    }
    throw err;
  }
}

// Запуск сервера
const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  // Отримуємо код статусу з URL
  const statusCode = req.url.slice(1);
  const filePath = getFilePath(statusCode);
  
  // Перевірка, чи код статусу валідний
  if (!statusCode || isNaN(parseInt(statusCode))) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request: Status code required');
    return;
  }
  
  try {
    switch (req.method) {
      case 'GET':
        // GET: спочатку перевіряємо кеш
        try {
          const cachedImage = await fs.readFile(filePath);
          console.log(`Cache HIT: ${statusCode}`);
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          res.end(cachedImage);
        } catch (err) {
          if (err.code === 'ENOENT') {
            // Немає в кеші - завантажуємо з http.cat
            console.log(`Cache MISS: ${statusCode}, fetching from http.cat`);
            const image = await fetchFromHttpCat(statusCode);
            
            if (!image) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('Not Found: Image not available on http.cat');
              return;
            }
            
            // Зберігаємо в кеш
            await fs.writeFile(filePath, image);
            console.log(`Cached: ${statusCode}`);
            
            // Відправляємо відповідь
            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(image);
          } else {
            throw err;
          }
        }
        break;
        
      case 'PUT':
        // PUT: зберегти картинку в кеш
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
          const imageBuffer = Buffer.concat(chunks);
          await fs.writeFile(filePath, imageBuffer);
          console.log(`PUT: ${statusCode} saved to cache`);
          res.writeHead(201, { 'Content-Type': 'text/plain' });
          res.end('Created: Image saved to cache');
        });
        break;
        
      case 'DELETE':
        // DELETE: видалити картинку з кешу
        try {
          await fs.unlink(filePath);
          console.log(`DELETE: ${statusCode} removed from cache`);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK: Image deleted from cache');
        } catch (err) {
          if (err.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found: Image not in cache');
          } else {
            throw err;
          }
        }
        break;
        
      default:
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
    }
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// Ініціалізація та запуск
initCacheDir().then(() => {
  server.listen(port, host, () => {
    console.log(`Proxy server running at http://${host}:${port}/`);
    console.log(`Cache directory: ${cacheDir}`);
    console.log('Methods: GET (with proxy), PUT, DELETE');
    console.log('GET will fetch from https://http.cat if not cached');
  });
});