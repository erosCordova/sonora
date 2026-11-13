import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const secret = () => randomBytes(32).toString("hex");
const config = example
  .replace(/^APP_SECRET=.*$/m, `APP_SECRET=${secret()}`)
  .replace(/^WORKER_TOKEN=.*$/m, `WORKER_TOKEN=${secret()}`);
try {
  await writeFile(new URL("../.env", import.meta.url), config, { flag: "wx", mode: 0o600 });
  console.log("Archivo .env creado con claves nuevas. Revisa DATABASE_URL si tu PostgreSQL usa otros datos.");
  console.log("Para el worker, copia el valor WORKER_TOKEN de .env a worker/.env.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.log("Ya existe un archivo .env: se conservó sin cambios.");
  } else {
    throw error;
  }
}
