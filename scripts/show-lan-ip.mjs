import os from "node:os";

/** Print likely LAN IPv4 addresses (for phone WebView / .env). */
const nets = os.networkInterfaces();
for (const name of Object.keys(nets)) {
  for (const net of nets[name] ?? []) {
    if (net.family === "IPv4" && !net.internal) {
      console.log(`${net.address}\t(${name})`);
    }
  }
}
