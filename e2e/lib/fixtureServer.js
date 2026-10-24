const fs = require("fs");
const http = require("http");
const path = require("path");

// 50 KB/s, delivered in 16 KB chunks.
const THROTTLE_BYTES_PER_SEC = 50 * 1024;
const CHUNK_BYTES = 16 * 1024;

const MIME_TYPES = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
};

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match) return null;
  let start;
  let end;
  if (match[1] === "" && match[2] !== "") {
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1] || 0);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

async function streamThrottled(res, file, start, end, aborted) {
  const handle = await fs.promises.open(file, "r");
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let position = start;
  try {
    while (position <= end && !aborted()) {
      const want = Math.min(CHUNK_BYTES, end - position + 1);
      const { bytesRead } = await handle.read(buffer, 0, want, position);
      if (bytesRead === 0) break;
      res.write(buffer.subarray(0, bytesRead));
      position += bytesRead;
      await new Promise((resolve) =>
        setTimeout(resolve, (bytesRead / THROTTLE_BYTES_PER_SEC) * 1000),
      );
    }
  } finally {
    await handle.close();
    res.end();
  }
}

// Serves files from `dir`:
//   /media/<name>                  full speed
//   /throttled/<token>/<name>      throttled to ~50 KB/s
// Both support HTTP Range requests. Bound to 127.0.0.1 on a random port.
function startFixtureServer(dir) {
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    requests.push({ method: req.method, path: url.pathname, range: req.headers.range || null });

    const throttled = parts[0] === "throttled";
    const name = throttled ? parts[2] : parts[0] === "media" ? parts[1] : null;
    if (!name || parts.length < 2 || path.basename(name) !== name) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }

    const size = fs.statSync(file).size;
    const range = req.headers.range ? parseRange(req.headers.range, size) : null;
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const headers = {
      "Content-Type": MIME_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
    };
    if (range) {
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    res.writeHead(range ? 206 : 200, headers);

    if (req.method === "HEAD") {
      res.end();
      return;
    }
    if (throttled) {
      let aborted = false;
      res.on("close", () => {
        aborted = true;
      });
      await streamThrottled(res, file, start, end, () => aborted);
      return;
    }
    fs.createReadStream(file, { start, end }).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

module.exports = { startFixtureServer, THROTTLE_BYTES_PER_SEC };
