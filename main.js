const fs = require('fs').promises;
const http = require('http');
const path = require('path');
const { Command } = require('commander');
const superagent = require('superagent');

const program = new Command();
program
  .requiredOption('-h, --host <host>', 'адреса сервера')
  .requiredOption('-p, --port <port>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до директорії кешу');

program.parse(process.argv);
const options = program.opts();

async function ensureCacheDir() {
  try {
    await fs.access(options.cache);
  } catch {
    await fs.mkdir(options.cache, { recursive: true });
    console.log(`Створено директорію кешу: ${options.cache}`);
  }
}

function getCachePath(code) {
  return path.join(options.cache, `${code}.jpg`);
}

async function downloadFromHttpCat(code) {
  const url = `https://http.cat/${code}`;
  const response = await superagent.get(url).responseType('arraybuffer');
  return response.body;
}

async function startServer() {
  await ensureCacheDir();

  const server = http.createServer(async (req, res) => {
    const code = req.url.slice(1);
    if (!code) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const filePath = getCachePath(code);

    // Сувора перевірка методу
    if (req.method === 'GET') {
      try {
        const image = await fs.readFile(filePath);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/jpeg');
        res.end(image);
        console.log(`GET /${code} -> з кешу`);
      } catch {
        console.log(`GET /${code} -> немає в кеші, запит до http.cat`);
        try {
          const image = await downloadFromHttpCat(code);
          await fs.writeFile(filePath, image);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/jpeg');
          res.end(image);
        } catch {
          res.statusCode = 404;
          res.end('Not Found');
        }
      }
    } 
    else if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        const image = Buffer.concat(chunks);
        try {
          await fs.writeFile(filePath, image);
          res.statusCode = 201;
          res.end('Created');
          console.log(`PUT /${code} -> збережено`);
        } catch {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });
    } 
    else if (req.method === 'DELETE') {
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        res.statusCode = 200;
        res.end('Deleted');
        console.log(`DELETE /${code} -> видалено`);
      } catch {
        res.statusCode = 404;
        res.end('Not Found');
      }
    } 
    else {
      // Будь-який інший метод (POST, PATCH, OPTIONS, тощо)
      res.statusCode = 405;
      res.end('Method Not Allowed');
      console.log(`${req.method} /${code} -> 405`);
    }
  });

  server.listen(options.port, options.host, () => {
    console.log(`Проксі-сервер запущено на http://${options.host}:${options.port}/`);
    console.log(`Директорія кешу: ${options.cache}`);
  });
}

startServer().catch(console.error);